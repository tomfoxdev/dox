package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"dox/internal/store"

	"github.com/jackc/pgx/v5/pgxpool"
)

type apiServer struct {
	store *store.Store
}

type errorResponse struct {
	Error string `json:"error"`
}

type createFolderRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

type createDocumentRequest struct {
	Title    string  `json:"title"`
	FolderID *string `json:"folder_id"`
	Content  string  `json:"content"`
}

type updateDocumentRequest struct {
	Title    string  `json:"title"`
	FolderID *string `json:"folder_id"`
	Content  string  `json:"content"`
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://localhost:5432/dox?sslmode=disable"
		log.Println("DATABASE_URL not set, using default local database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	server := &apiServer{store: store.New(db)}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", server.handleHealth)
	mux.HandleFunc("/api/drive", server.handleDrive)
	mux.HandleFunc("/api/folders", server.handleFolders)
	mux.HandleFunc("/api/documents", server.handleDocuments)
	mux.HandleFunc("/api/documents/", server.handleDocument)

	fileServer := http.FileServer(http.Dir("public"))
	mux.Handle("/", fileServer)

	httpServer := &http.Server{
		Addr:              ":8080",
		Handler:           withLogging(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Println("dox server listening on :8080")
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Truncate(time.Millisecond))
	})
}

func (s *apiServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *apiServer) handleDrive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	parentID := parseOptionalID(r.URL.Query().Get("parent_id"))

	listing, err := s.store.ListDrive(r.Context(), parentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load drive")
		return
	}

	writeJSON(w, http.StatusOK, listing)
}

func (s *apiServer) handleFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req createFolderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "folder name is required")
		return
	}

	folder, err := s.store.CreateFolder(r.Context(), name, req.ParentID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create folder")
		return
	}

	writeJSON(w, http.StatusCreated, folder)
}

func (s *apiServer) handleDocuments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req createDocumentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Untitled"
	}

	doc, err := s.store.CreateDocument(r.Context(), title, req.Content, req.FolderID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create document")
		return
	}

	writeJSON(w, http.StatusCreated, doc)
}

func (s *apiServer) handleDocument(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/documents/")
	if id == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		doc, err := s.store.GetDocument(r.Context(), id)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "document not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to load document")
			return
		}
		writeJSON(w, http.StatusOK, doc)
	case http.MethodPut:
		var req updateDocumentRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		title := strings.TrimSpace(req.Title)
		if title == "" {
			title = "Untitled"
		}

		doc, err := s.store.UpdateDocument(r.Context(), id, title, req.Content, req.FolderID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeError(w, http.StatusNotFound, "document not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to update document")
			return
		}

		writeJSON(w, http.StatusOK, doc)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func parseOptionalID(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid JSON payload")
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("invalid JSON payload")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, errorResponse{Error: message})
}

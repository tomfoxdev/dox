package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("not found")

const queryTimeout = 3 * time.Second

type Store struct {
	db *pgxpool.Pool
}

type Folder struct {
	ID        string    `json:"id"`
	ParentID  *string   `json:"parent_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Document struct {
	ID        string    `json:"id"`
	FolderID  *string   `json:"folder_id"`
	Title     string    `json:"title"`
	Content   string    `json:"content,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DriveListing struct {
	Folders   []Folder   `json:"folders"`
	Documents []Document `json:"documents"`
}

func New(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) ListDrive(ctx context.Context, parentID *string) (DriveListing, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	listing := DriveListing{
		Folders:   []Folder{},
		Documents: []Document{},
	}

	folderQuery := `
    SELECT id, parent_id, name, created_at, updated_at
    FROM folders
    WHERE ($1::uuid IS NULL AND parent_id IS NULL) OR parent_id = $1
    ORDER BY name
  `

	folderRows, err := s.db.Query(ctx, folderQuery, parentID)
	if err != nil {
		return listing, err
	}
	defer folderRows.Close()

	for folderRows.Next() {
		var folder Folder
		if err := folderRows.Scan(&folder.ID, &folder.ParentID, &folder.Name, &folder.CreatedAt, &folder.UpdatedAt); err != nil {
			return listing, err
		}
		listing.Folders = append(listing.Folders, folder)
	}
	if err := folderRows.Err(); err != nil {
		return listing, err
	}

	docQuery := `
    SELECT id, folder_id, title, created_at, updated_at
    FROM documents
    WHERE ($1::uuid IS NULL AND folder_id IS NULL) OR folder_id = $1
    ORDER BY updated_at DESC
  `

	docRows, err := s.db.Query(ctx, docQuery, parentID)
	if err != nil {
		return listing, err
	}
	defer docRows.Close()

	for docRows.Next() {
		var doc Document
		if err := docRows.Scan(&doc.ID, &doc.FolderID, &doc.Title, &doc.CreatedAt, &doc.UpdatedAt); err != nil {
			return listing, err
		}
		listing.Documents = append(listing.Documents, doc)
	}

	if err := docRows.Err(); err != nil {
		return listing, err
	}

	return listing, nil
}

func (s *Store) CreateFolder(ctx context.Context, name string, parentID *string) (Folder, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	folder := Folder{}
	query := `
    INSERT INTO folders (name, parent_id)
    VALUES ($1, $2)
    RETURNING id, parent_id, name, created_at, updated_at
  `

	err := s.db.QueryRow(ctx, query, name, parentID).Scan(
		&folder.ID,
		&folder.ParentID,
		&folder.Name,
		&folder.CreatedAt,
		&folder.UpdatedAt,
	)
	return folder, err
}

func (s *Store) CreateDocument(ctx context.Context, title string, content string, folderID *string) (Document, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	doc := Document{}
	query := `
    INSERT INTO documents (title, content, folder_id)
    VALUES ($1, $2, $3)
    RETURNING id, folder_id, title, content, created_at, updated_at
  `

	err := s.db.QueryRow(ctx, query, title, content, folderID).Scan(
		&doc.ID,
		&doc.FolderID,
		&doc.Title,
		&doc.Content,
		&doc.CreatedAt,
		&doc.UpdatedAt,
	)
	return doc, err
}

func (s *Store) GetDocument(ctx context.Context, id string) (Document, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	doc := Document{}
	query := `
    SELECT id, folder_id, title, content, created_at, updated_at
    FROM documents
    WHERE id = $1
  `

	err := s.db.QueryRow(ctx, query, id).Scan(
		&doc.ID,
		&doc.FolderID,
		&doc.Title,
		&doc.Content,
		&doc.CreatedAt,
		&doc.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return doc, ErrNotFound
		}
		return doc, err
	}

	return doc, nil
}

func (s *Store) UpdateDocument(ctx context.Context, id string, title string, content string, folderID *string) (Document, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()

	doc := Document{}
	query := `
    UPDATE documents
    SET title = $2,
        content = $3,
        folder_id = $4,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, folder_id, title, content, created_at, updated_at
  `

	err := s.db.QueryRow(ctx, query, id, title, content, folderID).Scan(
		&doc.ID,
		&doc.FolderID,
		&doc.Title,
		&doc.Content,
		&doc.CreatedAt,
		&doc.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return doc, ErrNotFound
		}
		return doc, err
	}

	return doc, nil
}

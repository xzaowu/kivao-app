package model

import "time"

// EcommerceProject keeps only the active round. Archived rounds are paged separately.
type EcommerceProject struct {
	ID            string    `json:"id" gorm:"primaryKey;size:36"`
	UserID        string    `json:"-" gorm:"size:36;not null;index:idx_ecommerce_owner_updated,priority:1"`
	Name          string    `json:"name" gorm:"size:160;not null"`
	Status        string    `json:"status" gorm:"size:32;not null"`
	CreateHash    string    `json:"-" gorm:"size:64;not null"`
	ActiveRoundID string    `json:"activeRoundId" gorm:"size:36;not null"`
	DraftJSON     string    `json:"-" gorm:"type:text;not null"`
	PlanJSON      string    `json:"-" gorm:"type:text;not null"`
	Revision      int64     `json:"revision" gorm:"not null;default:1"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt" gorm:"index:idx_ecommerce_owner_updated,priority:2"`
}

type EcommerceRound struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"-" gorm:"size:36;not null;index:idx_ecommerce_round_list,priority:1"`
	ProjectID string    `json:"projectId" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_round_ordinal,priority:1;index:idx_ecommerce_round_list,priority:2"`
	Ordinal   int64     `json:"ordinal" gorm:"not null;uniqueIndex:idx_ecommerce_round_ordinal,priority:2"`
	DraftJSON string    `json:"-" gorm:"type:text;not null"`
	PlanJSON  string    `json:"-" gorm:"type:text;not null"`
	CreatedAt time.Time `json:"createdAt"`
}

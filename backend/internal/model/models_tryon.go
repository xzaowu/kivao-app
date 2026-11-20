package model

// The batch marker serializes submission and deletion, including a late
// submission for a slot that did not yet have a task when the batch was deleted.
type TryOnBatch struct {
	UserID  string `gorm:"size:64;primaryKey"`
	BatchID string `gorm:"size:64;primaryKey"`
	Deleted bool   `gorm:"not null;default:false"`
}

type TryOnTaskReceipt struct {
	UserID  string `gorm:"size:64;primaryKey"`
	BatchID string `gorm:"size:64;primaryKey"`
	SlotKey string `gorm:"size:96;primaryKey"`
	TaskID  string `gorm:"size:64;not null;uniqueIndex"`
}

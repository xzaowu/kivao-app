package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestPaymentMethodMigrationPreservesExistingOrders(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE payment_orders (id text PRIMARY KEY, amount_fen bigint, status text)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO payment_orders (id,amount_fen,status) VALUES ('existing',100,'pending')").Error; err != nil {
		t.Fatal(err)
	}
	var apply func(*gorm.DB) error
	for _, migration := range schemaMigrations {
		if migration.version == 79 {
			apply = migration.apply
		}
	}
	if apply == nil {
		t.Fatal("method migration missing")
	}
	for range 2 {
		if err := apply(db); err != nil {
			t.Fatal(err)
		}
	}
	var order struct {
		ID            string
		AmountFen     int64
		Status        string
		PaymentMethod string
	}
	if err := db.Table("payment_orders").First(&order).Error; err != nil {
		t.Fatal(err)
	}
	if order.ID != "existing" || order.AmountFen != 100 || order.Status != "pending" || order.PaymentMethod != "" {
		t.Fatal("historical order changed")
	}
}

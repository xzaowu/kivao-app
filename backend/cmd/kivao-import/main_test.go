package main

import "testing"

func TestLocalDatabaseBoundary(t *testing.T) {
	for _, dsn := range []string{"postgres://u:p@127.0.0.1:5432/kivao_rehearsal_source?sslmode=disable", "postgres://u:p@[::1]:5432/kivao_rehearsal_target?sslmode=disable"} {
		if _, err := localDatabaseID(dsn); err != nil {
			t.Fatal("local rehearsal rejected")
		}
	}
	for _, dsn := range []string{"", "postgres://u:p@prod.example/db", "postgres://u:p@127.0.0.1/yingce", "postgres://u:p@localhost/kivao_rehearsal_source", "postgres://u:p@127.0.0.1/kivao_rehearsal_source?search_path=production", "host=127.0.0.1,prod.example dbname=kivao_rehearsal_source", "postgres://u:p@127.0.0.1/kivao_rehearsal_source?options=-c%20search_path=production"} {
		if _, err := localDatabaseID(dsn); err == nil {
			t.Fatal("unsafe DSN accepted")
		}
	}
}

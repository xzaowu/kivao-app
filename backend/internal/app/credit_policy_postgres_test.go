package app

import (
	"sync"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCreditPolicyPostgresFreshReadsPreserveConfiguredRewardsAndLedger(t *testing.T) {
	writer, db := newProjectNameConflictPostgresService(t)
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.AdminAuditEvent{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	admin := model.User{ID: "pg-admin", Username: "pg-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := model.User{ID: "pg-owner", Username: "pg-owner", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(&[]model.User{admin, user}).Error; err != nil {
		t.Fatal(err)
	}
	reader := &Service{repo: repository.New(db)}
	policy := defaultCreditPolicy()
	policy.SignupBonusMicrocredits = 2 * CreditScale
	policy.CheckinBonusMicrocredits = CreditScale
	policy.DefaultMultiplierBPS = 12_000
	if _, err := writer.UpdateCreditPolicy(&admin, policy); err != nil {
		t.Fatal(err)
	}
	if _, _, err := writer.repo.GrantCreditsOnce(user.ID, model.CreditLedgerPaymentTopup, 7*CreditScale, "pg-payment", "fixture credits"); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.creditPolicy(); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, instance := range []*Service{writer, reader} {
		wg.Add(1)
		go func(s *Service) { defer wg.Done(); results <- s.ensureSignupBonus(user.ID) }(instance)
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	before, err := reader.repo.CreditAccount(user.ID)
	if err != nil || before.AvailableMicrocredits != 9*CreditScale {
		t.Fatalf("explicit grant was not idempotent: %v %v", before, err)
	}
	policy.SignupBonusMicrocredits, policy.CheckinBonusMicrocredits = 0, 0
	if _, err := writer.UpdateCreditPolicy(&admin, policy); err != nil {
		t.Fatal(err)
	}
	fresh, err := reader.creditPolicy()
	if err != nil || fresh.SignupBonusMicrocredits != 0 || fresh.CheckinBonusMicrocredits != 0 || fresh.DefaultMultiplierBPS != 12_000 {
		t.Fatalf("stale or changed policy: %v %v", fresh, err)
	}
	if err := reader.ensureSignupBonus("unclaimed"); err != nil {
		t.Fatal(err)
	}
	if _, granted, err := reader.CheckinCredits(&user); err == nil || granted {
		t.Fatalf("disabled checkin: %t %v", granted, err)
	}
	after, err := reader.repo.CreditAccount(user.ID)
	if err != nil || *before != *after {
		t.Fatalf("existing balance changed: %v %v", after, err)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("ledger changed: %d %v", count, err)
	}
	if err := writer.repo.DeleteSystemSetting(creditPolicySettingKey); err != nil {
		t.Fatal(err)
	}
	fresh, err = reader.creditPolicy()
	if err != nil || fresh.SignupBonusMicrocredits != 0 || fresh.CheckinBonusMicrocredits != 0 {
		t.Fatalf("deleted policy restored rewards: %v %v", fresh, err)
	}
}

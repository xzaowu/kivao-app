package app

import (
	"context"
	"fmt"
	"gorm.io/gorm"
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestBillingAutoRefundScanAdvancesPastFailuresAndBacksOff(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Task{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	// 相同时间戳覆盖稳定 ID 排序；第一页全部失败，最后一个订单必须仍可被扫描到。
	created := time.Now().Add(-time.Hour)
	for i := 0; i <= billingAutoRefundBatch; i++ {
		id := fmt.Sprintf("order-%03d", i)
		reserved := int64(0)
		if i == 0 {
			reserved = 100
		}
		for _, value := range []any{
			&model.Task{ID: id, UserID: id, BillingOrderID: id, Status: model.TaskStatusFailed, ExecutionDiagnosticJSON: `{"submissionOutcome":"not_submitted"}`},
			&model.CreditAccount{UserID: id, ReservedMicrocredits: reserved},
			&model.BillingOrder{ID: id, UserID: id, TaskID: id, IdempotencyKey: id, Status: model.BillingStatusReserved, AmountMicrocredits: 100, CreatedAt: created},
		} {
			if err := db.Create(value).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	attempts := 0
	if err := db.Callback().Update().Before("gorm:update").Register("test:refund_attempts", func(tx *gorm.DB) {
		if tx.Statement.Table == "credit_accounts" {
			attempts++
		}
	}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 || attempts != billingAutoRefundBatch {
		t.Fatalf("first page refunded=%d attempts=%d", got, attempts)
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 1 || attempts != billingAutoRefundBatch+1 {
		t.Fatalf("second page refunded=%d attempts=%d", got, attempts)
	}
	if svc.billingAutoRefund.cursor != nil {
		t.Fatal("completed scan must wrap to newest orders")
	}
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 || attempts != billingAutoRefundBatch+1 {
		t.Fatalf("cooling page refunded=%d attempts=%d", got, attempts)
	}
	// 冷却到期后允许重试，而非永久跳过；顺便验证最末页为空时复位。
	for id, failure := range svc.billingAutoRefund.failures {
		failure.retryAt = time.Now().Add(-time.Second)
		svc.billingAutoRefund.failures[id] = failure
	}
	svc.autoRefundReviewBilling(t.Context())
	svc.autoRefundReviewBilling(t.Context())
	if attempts != 2*billingAutoRefundBatch+1 {
		t.Fatalf("retry attempts=%d", attempts)
	}
}

func TestBillingAutoRefundScanSkipsOverlappingRun(t *testing.T) {
	svc := &Service{}
	svc.billingAutoRefund.mu.Lock()
	defer svc.billingAutoRefund.mu.Unlock()
	// repo 故意留空：重叠调用必须在访问数据库前返回。
	if got := svc.autoRefundReviewBilling(t.Context()); got != 0 {
		t.Fatalf("overlapping run refunded=%d", got)
	}
}

func TestBillingAutoRefundBackoffIsBounded(t *testing.T) {
	var scan billingAutoRefundScan
	now := time.Now()
	for i := 0; i < 20; i++ {
		scan.recordFailure("persistent", now)
	}
	if got := scan.failures["persistent"].delay; got != time.Hour {
		t.Fatalf("maximum delay=%s", got)
	}
	for i := 0; i < billingAutoRefundBatch*20; i++ {
		scan.recordFailure(fmt.Sprint(i), now)
	}
	if len(scan.failures) != billingAutoRefundBatch*10 {
		t.Fatalf("failure entries=%d", len(scan.failures))
	}
}

func TestBillingAutoRefundCancelledScanDoesNotAdvance(t *testing.T) {
	db := newSQLiteTestDB(t)
	svc := &Service{repo: repository.New(db)}
	cursor := &repository.BillingAutoRefundCursor{CreatedAt: time.Now(), ID: "previous"}
	svc.billingAutoRefund.cursor = cursor
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if got := svc.autoRefundReviewBilling(ctx); got != 0 || svc.billingAutoRefund.cursor != cursor {
		t.Fatalf("cancelled scan refunded=%d cursor=%+v", got, svc.billingAutoRefund.cursor)
	}
}

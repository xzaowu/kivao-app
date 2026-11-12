package repository

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Each child has its own connection pool and process memory. Pipes form a start
// barrier, so this checks database coordination rather than an in-process mutex.
func TestBillingTerminalMultipleProcessesPostgres(t *testing.T) {
	db := newBillingTerminalDB(t, "postgres")
	for _, mode := range []string{"mixed", "restore", "retry"} {
		t.Run(mode, func(t *testing.T) {
			status := model.BillingStatusReserved
			if mode == "restore" {
				status = model.BillingStatusRefunded
			}
			order := seedBillingTerminalOrder(t, db, mode, status, model.TaskStatusFailed)
			ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancel()
			type worker struct {
				cmd    *exec.Cmd
				input  io.WriteCloser
				output *bufio.Reader
			}
			workers := make([]worker, 0, 6)
			for i := range 6 {
				operation := mode
				if mode == "mixed" {
					operation = []string{"settle", "refund", "automatic"}[i%3]
				} else if mode == "retry" && i > 0 {
					operation = "automatic"
				}
				cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestBillingTerminalProcessWorker$", "-test.timeout=25s")
				cmd.Env = append(os.Environ(), "KIVAO_BILLING_TEST_WORKER=1",
					"KIVAO_BILLING_TEST_DSN="+db.Dialector.(*postgres.Dialector).Config.DSN,
					"KIVAO_BILLING_TEST_ORDER="+order.ID, "KIVAO_BILLING_TEST_OPERATION="+operation)
				input, err := cmd.StdinPipe()
				if err != nil {
					t.Fatal(err)
				}
				output, err := cmd.StdoutPipe()
				if err != nil {
					t.Fatal(err)
				}
				if err := cmd.Start(); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					_ = input.Close()
					if cmd.ProcessState == nil {
						_ = cmd.Process.Kill()
						_ = cmd.Wait()
					}
				})
				reader := bufio.NewReader(output)
				ready, err := reader.ReadString('\n')
				if err != nil || ready != "ready\n" {
					t.Fatalf("worker did not reach start barrier: %v", err)
				}
				workers = append(workers, worker{cmd, input, reader})
			}
			for _, worker := range workers {
				if _, err := io.WriteString(worker.input, "start\n"); err != nil {
					t.Fatal(err)
				}
				_ = worker.input.Close()
			}
			for _, worker := range workers {
				output, readErr := io.ReadAll(worker.output)
				if err := worker.cmd.Wait(); err != nil || readErr != nil {
					t.Fatalf("worker failed: %v, read=%v, output=%s", err, readErr, output)
				}
			}
			stored, err := New(db).BillingOrder(order.ID)
			if err != nil {
				t.Fatal(err)
			}
			available, reserved, entries := int64(1000), int64(9900), int64(1)
			if stored.Status == model.BillingStatusRefunded {
				available += 100
			} else if stored.Status != model.BillingStatusSettled {
				t.Fatalf("unexpected terminal status: %s", stored.Status)
			}
			if mode == "restore" {
				available, reserved = 900, 10000
			} else if mode == "retry" {
				available, reserved, entries = 1000, 10000, 2
				task, err := New(db).Task(order.TaskID)
				if err != nil || task.Status != model.TaskStatusQueued || task.BillingOrderID != "retry-attempt" || stored.Status != model.BillingStatusRefunded {
					t.Fatalf("retry did not atomically replace old reservation: %v", err)
				}
			}
			account, err := New(db).CreditAccount(order.UserID)
			if err != nil || account.AvailableMicrocredits != available || account.ReservedMicrocredits != reserved {
				t.Fatalf("unexpected balances after process contention: %+v err=%v", account, err)
			}
			var count int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("user_id = ?", order.UserID).Count(&count).Error; err != nil || count != entries {
				t.Fatalf("ledger count=%d want=%d err=%v", count, entries, err)
			}
		})
	}
}

func TestBillingTerminalProcessWorker(t *testing.T) {
	if os.Getenv("KIVAO_BILLING_TEST_WORKER") != "1" {
		t.Skip("invoked by the isolated PostgreSQL process test")
	}
	db, err := gorm.Open(postgres.Open(os.Getenv("KIVAO_BILLING_TEST_DSN")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("worker database connection failed")
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	fmt.Fprintln(os.Stdout, "ready")
	start, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil || start != "start\n" {
		t.Fatal("start barrier was not released")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	repo := New(db.WithContext(ctx))
	id := os.Getenv("KIVAO_BILLING_TEST_ORDER")
	switch os.Getenv("KIVAO_BILLING_TEST_OPERATION") {
	case "settle":
		err = repo.SettleBillingOrder(id, "test-provider")
	case "refund":
		err = repo.RefundBillingOrder(id, "test refund")
	case "automatic":
		_, err = repo.AutoRefundBillingOrder(id, "test automatic", permitTestBillingRelease)
	case "restore":
		err = repo.RestoreRefundedBillingOrder(id, "test-provider")
	case "retry":
		order := &model.BillingOrder{ID: "retry-attempt", UserID: id, TaskID: id, IdempotencyKey: "retry-attempt", Status: model.BillingStatusReserved, AmountMicrocredits: 100}
		_, err = repo.RetryTaskWithBilling(id, &model.Task{ID: id}, order, 100, permitTestBillingRelease)
	default:
		t.Fatal("unknown worker operation")
	}
	if err != nil && !(id == "mixed" && (strings.EqualFold(err.Error(), "billing order already refunded") || err.Error() == "settled billing order requires a manual refund")) {
		t.Fatal(err)
	}
}

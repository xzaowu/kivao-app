package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

// Only synthetic rows in a temporary SQLite file or a separate test PG schema.
func systemProxyBillingService(t *testing.T) (*service.Service, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "proxy.db"))
	if dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN"); dsn != "" {
		redisURL := os.Getenv("CANVAS_TEST_REDIS_URL")
		if redisURL == "" {
			t.Fatal("isolated PG proxy test requires CANVAS_TEST_REDIS_URL")
		}
		t.Setenv("REDIS_URL", redisURL)
		admin, err := gorm.Open(postgres.Open(dsn), options)
		if err != nil {
			t.Fatal(err)
		}
		adminSQL, err := admin.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = adminSQL.Close() })
		schema := fmt.Sprintf("system_proxy_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialector = postgres.Open(parsed.String())
	}
	db, err := gorm.Open(dialector, options)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"creditsEnabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous); _ = svc.Close() })
	return svc, db
}

func systemProxyBillingRows(t *testing.T, db *gorm.DB, protocol model.ChannelInterfaceType, billingMode, upstreamURL string) (*model.User, *model.ModelChannel) {
	t.Helper()
	user := &model.User{ID: uuid.NewString(), Username: uuid.NewString(), Email: uuid.NewString() + "@example.invalid", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	channel := &model.ModelChannel{ID: uuid.NewString(), Name: "test", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstreamURL, APIFormat: "openai", ModelsJSON: `["test-model"]`}
	item := &model.ChannelModel{ID: uuid.NewString(), ChannelID: channel.ID, ModelKey: "test-model", Capability: "text", Protocol: protocol, Enabled: true, BillingMode: billingMode}
	tier := &model.ChannelModelPriceTier{ID: uuid.NewString(), ChannelModelID: item.ID, BillingMode: billingMode, PriceConfigured: true, Enabled: true, UnitPriceMicrocredits: 100, InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 1_000_000, PriceVersion: 1}
	for _, row := range []any{user, channel, item, tier, &model.CreditAccount{UserID: user.ID, AvailableMicrocredits: 100_000}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return user, channel
}

func TestSystemProxyTextStreamBillingCompletion(t *testing.T) {
	testSystemProxyTextStreamBillingCompletion(t, false)
}

func TestSystemProxyPluginTextStreamBillingCompletion(t *testing.T) {
	testSystemProxyTextStreamBillingCompletion(t, true)
}

func testSystemProxyTextStreamBillingCompletion(t *testing.T, alias bool) {
	svc, db := systemProxyBillingService(t)
	for _, wire := range []struct {
		protocol                          model.ChannelInterfaceType
		path, delta, complete, incomplete string
	}{
		{model.ChannelInterfaceChatCompletion, "/chat/completions",
			"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"draft\"}}]}\n\n",
			"data: {\"choices\":[{\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":7}}\n\ndata: [DONE]\n\n",
			"data: {\"choices\":[{\"index\":0,\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":7}}\n\ndata: [DONE]\n\n"},
		{model.ChannelInterfaceOpenAIResponse, "/responses",
			"event: response.output_text.delta\ndata: {\"delta\":\"draft\"}\n\n",
			"event: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":7}}}\n\n",
			"event: response.incomplete\ndata: {\"response\":{\"status\":\"incomplete\",\"usage\":{\"input_tokens\":3,\"output_tokens\":7}}}\n\n"},
		{model.ChannelInterfaceClaudeAPI, "/messages",
			"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"draft\"}}\n\n",
			"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"input_tokens\":3,\"output_tokens\":7}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
			"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"},\"usage\":{\"input_tokens\":3,\"output_tokens\":7}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"},
	} {
		if alias {
			id := "test-alias-" + string(wire.protocol)
			auth := `{"type":"header","header":"x-alias-key","field":"apiKey"}`
			installProxyFixturePlugin(t, svc, id, wire.path, auth)
			wire.protocol = model.ChannelInterfaceType(id)
		}
		for _, billingMode := range []string{"fixed_request", "token"} {
			for _, scenario := range []string{"complete", "missing_terminal", "incomplete", "error_after_text", "error_after_complete", "malformed", "empty", "http_rejected", "http_timeout", "json_reply"} {
				t.Run(string(wire.protocol)+"/"+billingMode+"/"+scenario, func(t *testing.T) {
					responseBody := wire.delta
					statusCode := http.StatusOK
					contentType := "text/event-stream; charset=utf-8"
					wantStatus := model.BillingStatusUncertain
					switch scenario {
					case "complete":
						responseBody += wire.complete
						wantStatus = model.BillingStatusSettled
					case "incomplete":
						responseBody += wire.incomplete
					case "error_after_text":
						responseBody += "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"test provider private-sentinel\"}}\n\n"
					case "error_after_complete":
						responseBody += wire.complete + "event: error\ndata: {}\n\n"
					case "malformed":
						responseBody += "data: {\"truncated\":\n\n"
					case "empty":
						responseBody = ""
					case "http_rejected", "http_timeout":
						responseBody = "event: error\ndata: {\"error\":{\"message\":\"test rejection\"}}\n\n"
						statusCode = http.StatusBadRequest
						wantStatus = model.BillingStatusRefunded
						if scenario == "http_timeout" {
							statusCode = 524
							wantStatus = model.BillingStatusUncertain
						}
					case "json_reply":
						contentType = "application/json"
						responseBody = `{"choices":[{"message":{"content":"done"}}],"usage":{"input_tokens":3,"output_tokens":7}}`
						wantStatus = model.BillingStatusSettled
					}
					var calls atomic.Int32
					upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls.Add(1)
						if alias {
							if r.URL.Path != "/v1"+wire.path || r.Header.Get("x-alias-key") != "fixture-key" {
								t.Error("declared path or auth was lost")
							}
							if billingMode == "token" && wire.path == "/chat/completions" {
								var payload map[string]any
								if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
									t.Error(err)
								}
								options, _ := payload["stream_options"].(map[string]any)
								if options["include_usage"] != true {
									t.Error("aliased chat stream lost token usage request")
								}
							}
						}
						w.Header().Set("Content-Type", contentType)
						w.WriteHeader(statusCode)
						_, _ = io.WriteString(w, responseBody)
					}))
					defer upstream.Close()
					user, channel := systemProxyBillingRows(t, db, wire.protocol, billingMode, upstream.URL)
					if alias {
						channel.APIKey = "fixture-key"
					}
					recorder := httptest.NewRecorder()
					c, _ := gin.CreateTestContext(recorder)
					c.Request = httptest.NewRequest(http.MethodPost, "/api/ai/system/"+channel.ID+wire.path, strings.NewReader(`{"model":"test-model","stream":true,"messages":[{"role":"user","content":"test"}],"max_tokens":32}`))
					c.Request.Header.Set("Content-Type", "application/json")
					proxySystemRequestPath(c, svc, user, channel, wire.path)
					if recorder.Code != statusCode || recorder.Body.String() != responseBody || calls.Load() != 1 {
						t.Fatalf("proxy status=%d calls=%d raw stream preserved=%v", recorder.Code, calls.Load(), recorder.Body.String() == responseBody)
					}
					if scenario != "json_reply" && recorder.Header().Get("X-Accel-Buffering") != "no" {
						t.Fatal("SSE buffering protection lost")
					}
					var order model.BillingOrder
					var account model.CreditAccount
					var call model.ApiCallLog
					for _, row := range []any{&order, &account, &call} {
						if err := db.First(row, "user_id = ?", user.ID).Error; err != nil {
							t.Fatal(err)
						}
					}
					if wantStatus == model.BillingStatusSettled {
						wantAmount := int64(100)
						if billingMode == "token" {
							wantAmount = 10
						}
						if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != wantAmount || account.ReservedMicrocredits != 0 || account.AvailableMicrocredits != 100_000-wantAmount || call.Status != model.ApiCallStatusSucceeded {
							t.Fatalf("complete: order=%s amount=%d available=%d reserved=%d log=%s", order.Status, order.ActualAmountMicrocredits, account.AvailableMicrocredits, account.ReservedMicrocredits, call.Status)
						}
					} else if wantStatus == model.BillingStatusRefunded {
						if order.Status != wantStatus || account.ReservedMicrocredits != 0 || account.AvailableMicrocredits != 100_000 || call.Status != model.ApiCallStatusFailed {
							t.Fatalf("explicit rejection: order=%s available=%d reserved=%d log=%s", order.Status, account.AvailableMicrocredits, account.ReservedMicrocredits, call.Status)
						}
					} else {
						if order.Status != model.BillingStatusUncertain || order.ActualAmountMicrocredits != 0 || order.RefundedAmountMicrocredits != 0 || account.ReservedMicrocredits != order.ReservedAmountMicrocredits || account.AvailableMicrocredits+account.ReservedMicrocredits != 100_000 || call.Status != model.ApiCallStatusFailed {
							t.Fatalf("incomplete: order=%s amount=%d available=%d reserved=%d log=%s", order.Status, order.ActualAmountMicrocredits, account.AvailableMicrocredits, account.ReservedMicrocredits, call.Status)
						}
						var entries int64
						if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type <> ?", order.ID, model.CreditLedgerReserve).Count(&entries).Error; err != nil || entries != 0 {
							t.Fatalf("unexpected settlement/refund entries: %d %v", entries, err)
						}
					}
					if call.StatusCode != statusCode || call.BillingOrderID != order.ID {
						t.Fatal("call log lost HTTP status or billing association")
					}
					if scenario == "error_after_text" && (!strings.Contains(call.Error, "文本生成未正常完成") || strings.Contains(call.Error, "private-sentinel")) {
						t.Fatal("provider message overwrote the safe local completion failure")
					}
					if (scenario == "complete" || scenario == "incomplete" || scenario == "error_after_complete") && (!call.UsageAvailable || call.InputTokens != 3 || call.OutputTokens != 7) {
						t.Fatal("stream completion check discarded usage evidence")
					}
				})
			}
		}
	}
}

func installProxyFixturePlugin(t *testing.T, svc *service.Service, id, path, auth string) {
	t.Helper()
	raw := fmt.Sprintf(`{"apiVersion":"yingce.plugin/v1","id":"%s","version":"1.0.0","name":"Test Alias","contributes":{"providers":[{"id":"%s","label":"Test Alias","capabilities":["text"],"scopes":["admin.system-channel"],"auth":%s,"create":{"method":"POST","path":"/v1%s"},"response":{}}]}}`, id, id, auth, path)
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, err := writer.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(file, raw); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.InstallPlugin(buffer.Bytes(), id+".yingce-plugin"); err != nil {
		t.Fatal(err)
	}
}

func TestSystemProxyQueryAuthDoesNotLeakOnTransportFailure(t *testing.T) {
	svc, db := systemProxyBillingService(t)
	installProxyFixturePlugin(t, svc, "query-alias", "/chat/completions", `{"type":"query","query":"credential","field":"apiKey"}`)
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("closed upstream must not receive a request") }))
	upstream.Close()
	user, channel := systemProxyBillingRows(t, db, "query-alias", "fixed_request", upstream.URL)
	channel.APIKey = "query-secret-sentinel"
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/test/chat/completions", strings.NewReader(`{"model":"test-model","stream":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	proxySystemRequestPath(c, svc, user, channel, "/chat/completions")
	var call model.ApiCallLog
	var order model.BillingOrder
	if err := db.First(&call, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&order, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(call)
	if strings.Contains(string(encoded), channel.APIKey) || strings.Contains(recorder.Body.String(), channel.APIKey) {
		t.Fatal("query credential leaked into log or HTTP error")
	}
	if recorder.Code != http.StatusBadGateway || order.Status != model.BillingStatusUncertain || call.Status != model.ApiCallStatusFailed {
		t.Fatal("transport failure lost uncertainty or failure status")
	}
}

func TestSystemProxyPluginChangeDuringStreamPreservesCompletionCheck(t *testing.T) {
	svc, db := systemProxyBillingService(t)
	installProxyFixturePlugin(t, svc, "changing-alias", "/chat/completions", `{"type":"bearer","field":"apiKey"}`)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if _, err := svc.SetPluginEnabled("changing-alias", false); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"draft\"}}]}\n\n")
	}))
	defer upstream.Close()
	user, channel := systemProxyBillingRows(t, db, "changing-alias", "fixed_request", upstream.URL)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/test/chat/completions", strings.NewReader(`{"model":"test-model","stream":true}`))
	c.Request.Header.Set("Content-Type", "application/json")
	proxySystemRequestPath(c, svc, user, channel, "/chat/completions")
	var call model.ApiCallLog
	var order model.BillingOrder
	if err := db.First(&call, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&order, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 || order.Status != model.BillingStatusUncertain || call.Status != model.ApiCallStatusFailed {
		t.Fatal("plugin change bypassed completion check")
	}
}

type interruptedSystemProxyWriter struct {
	*httptest.ResponseRecorder
	cancel    context.CancelFunc
	failWrite bool
}

func (w *interruptedSystemProxyWriter) Write(data []byte) (int, error) {
	if w.cancel != nil {
		w.cancel()
	}
	if w.failWrite {
		return 0, errors.New("simulated downstream disconnect")
	}
	return w.ResponseRecorder.Write(data)
}

func TestSystemProxyStreamTransportFailurePreservesReservation(t *testing.T) {
	svc, db := systemProxyBillingService(t)
	for _, scenario := range []string{"upstream_disconnect", "downstream_write_failure", "cancel_after_complete"} {
		t.Run(scenario, func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"draft\"}}]}\n\n")
				if scenario == "upstream_disconnect" {
					w.(http.Flusher).Flush()
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					_ = conn.Close()
					return
				}
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
			}))
			defer upstream.Close()
			user, channel := systemProxyBillingRows(t, db, model.ChannelInterfaceChatCompletion, "fixed_request", upstream.URL)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			writer := &interruptedSystemProxyWriter{ResponseRecorder: httptest.NewRecorder(), failWrite: scenario == "downstream_write_failure"}
			if scenario == "cancel_after_complete" {
				writer.cancel = cancel
			}
			c, _ := gin.CreateTestContext(writer)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/ai/system/"+channel.ID+"/chat/completions", strings.NewReader(`{"model":"test-model","stream":true}`)).WithContext(ctx)
			c.Request.Header.Set("Content-Type", "application/json")
			proxySystemRequestPath(c, svc, user, channel, "/chat/completions")
			var order model.BillingOrder
			var account model.CreditAccount
			var call model.ApiCallLog
			for _, row := range []any{&order, &account, &call} {
				if err := db.First(row, "user_id = ?", user.ID).Error; err != nil {
					t.Fatal(err)
				}
			}
			if calls.Load() != 1 || order.Status != model.BillingStatusUncertain || order.ActualAmountMicrocredits != 0 || order.RefundedAmountMicrocredits != 0 || account.AvailableMicrocredits != 99_900 || account.ReservedMicrocredits != 100 || call.Status != model.ApiCallStatusFailed {
				t.Fatalf("calls=%d order=%s amount=%d available=%d reserved=%d log=%s", calls.Load(), order.Status, order.ActualAmountMicrocredits, account.AvailableMicrocredits, account.ReservedMicrocredits, call.Status)
			}
			if scenario == "upstream_disconnect" && strings.Contains(writer.Body.String(), "[DONE]") {
				t.Fatal("proxy fabricated a completion marker")
			}
		})
	}
}

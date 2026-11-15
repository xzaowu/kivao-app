package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type turnstileSecretSpyHost struct {
	wechatTestHost
	encryptCalls int
}

func (h *turnstileSecretSpyHost) EncryptSecret(value string) (string, error) {
	h.encryptCalls++
	return h.wechatTestHost.EncryptSecret(value)
}

func TestTurnstileSettingsRequireAdminAndPreserveEncryptedSecret(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	host := &turnstileSecretSpyHost{}
	svc.host = host
	request := TurnstileSettingRequest{Enabled: true, SiteKey: "fixture-site", SecretKey: "fixture-secret"}
	for _, actor := range []*model.User{nil, {ID: "ordinary", Role: model.UserRoleUser}} {
		if _, err := svc.AdminTurnstileSetting(actor); err == nil {
			t.Fatal("non-admin read Turnstile settings")
		}
		if _, err := svc.UpdateTurnstileSetting(actor, request); err == nil {
			t.Fatal("non-admin changed Turnstile settings")
		}
	}
	var count int64
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", turnstileSettingKey).Count(&count).Error; err != nil || count != 0 || host.encryptCalls != 0 {
		t.Fatalf("rejected settings update changed storage: rows=%d encryptCalls=%d err=%v", count, host.encryptCalls, err)
	}
	actor := &model.User{ID: "settings-admin", Username: "settings-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(actor).Error; err != nil {
		t.Fatal(err)
	}
	setting, err := svc.UpdateTurnstileSetting(actor, request)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.SystemSetting(turnstileSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	var value turnstileSettingValue
	if err := json.Unmarshal([]byte(stored.ValueJSON), &value); err != nil {
		t.Fatal(err)
	}
	if host.encryptCalls != 1 || value.SecretKey != "encrypted:"+request.SecretKey {
		t.Fatal("Turnstile secret bypassed the host encryption contract")
	}
	if !setting.HasSecretKey || strings.Contains(string(mustJSON(t, setting)), request.SecretKey) {
		t.Fatal("public settings did not redact the secret")
	}
	createdAt := setting.CreatedAt
	if _, err := svc.UpdateTurnstileSetting(actor, TurnstileSettingRequest{Enabled: false, SiteKey: request.SiteKey}); err != nil {
		t.Fatal(err)
	}
	retained, decoded, err := svc.readTurnstileSetting()
	if err != nil || decoded.SecretKey != request.SecretKey || decoded.Enabled || !retained.CreatedAt.Equal(createdAt) || host.encryptCalls != 2 {
		t.Fatal("blank-secret update did not preserve the encrypted setting")
	}
	public, err := svc.AdminTurnstileSetting(actor)
	if err != nil || public.Enabled || !public.HasSecretKey || strings.Contains(string(mustJSON(t, public)), request.SecretKey) {
		t.Fatal("reading disabled settings exposed or lost the secret")
	}
}

func TestTurnstileMissingTokenPreventsAuthenticationWrites(t *testing.T) {
	for _, entry := range []string{"password", "register", "verification", "wechat-register"} {
		t.Run(entry, func(t *testing.T) {
			svc, db, admin := newWechatTestService(t)
			if err := db.AutoMigrate(&model.AuthVerification{}); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.UpdateTurnstileSetting(admin, TurnstileSettingRequest{Enabled: true, SiteKey: "fixture-site", SecretKey: "fixture-secret"}); err != nil {
				t.Fatal(err)
			}
			svc.SetTurnstileHTTPClient(&http.Client{Transport: turnstileRoundTripper(func(*http.Request) (*http.Response, error) {
				t.Fatal("missing token reached Siteverify")
				return nil, errors.New("unexpected request")
			})})
			verification := &model.AuthVerification{ID: "pending-verification", Purpose: "login", Method: "email", UserID: admin.ID, TokenHash: HashToken(strings.Repeat("a", 64)), ExpiresAt: time.Now().Add(time.Minute)}
			if err := db.Create(verification).Error; err != nil {
				t.Fatal(err)
			}
			pending := &model.OAuthState{ID: "pending-wechat", Provider: wechatRegistrationProvider, StateHash: HashToken("wechat-ticket"), ClientID: "wx1234567890123456", ProfileJSON: `{"subject":"wx1234567890123456:fixture-user","name":"Fixture"}`, ExpiresAt: time.Now().Add(time.Minute)}
			if err := db.Create(pending).Error; err != nil {
				t.Fatal(err)
			}
			var err error
			switch entry {
			case "password":
				_, err = svc.Login(LoginRequest{Username: admin.Username, Password: "fixture-password"})
			case "register":
				_, err = svc.Register(RegisterRequest{Username: "new-fixture-user", Password: "fixture-password", AcceptedTerms: true})
			case "verification":
				_, err = svc.LoginVerification(VerificationConfirm{Ticket: verification.ID + "." + strings.Repeat("a", 64), EmailCode: "123456"})
			case "wechat-register":
				_, err = svc.CompleteWechatRegistration("wechat-ticket", RegisterRequest{AcceptedTerms: true})
			}
			var appErr *kernel.AppError
			if !errors.As(err, &appErr) || appErr.Status != http.StatusBadRequest || appErr.Message != "请完成安全验证" {
				t.Fatalf("missing token was not rejected by the Turnstile gate: %v", err)
			}
			for _, item := range []struct {
				entity any
				want   int64
			}{{&model.User{}, 1}, {&model.AuthSession{}, 0}, {&model.UserIdentity{}, 0}} {
				var count int64
				if err := db.Model(item.entity).Count(&count).Error; err != nil || count != item.want {
					t.Fatalf("rejected authentication wrote %T: count=%d err=%v", item.entity, count, err)
				}
			}
			if err := db.First(verification, "id = ?", verification.ID).Error; err != nil || verification.UsedAt != nil || verification.Attempts != 0 {
				t.Fatal("Turnstile rejection consumed the verification ticket")
			}
			if err := db.First(pending, "id = ?", pending.ID).Error; err != nil || pending.UsedAt != nil || pending.ProfileJSON == "" {
				t.Fatal("Turnstile rejection consumed the Wechat registration ticket")
			}
		})
	}
}

func TestTurnstileTransportFailuresRejectAndRespectContext(t *testing.T) {
	for _, failure := range []string{"network", "status", "invalid-json", "canceled"} {
		t.Run(failure, func(t *testing.T) {
			svc, db := newRegistrationTestService(t)
			if err := db.Create(&model.SystemSetting{Key: turnstileSettingKey, ValueJSON: `{"enabled":true,"siteKey":"fixture-site","secretKey":"fixture-secret"}`}).Error; err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if failure == "canceled" {
				cancel()
			}
			calls := 0
			svc.SetTurnstileHTTPClient(&http.Client{Transport: turnstileRoundTripper(func(req *http.Request) (*http.Response, error) {
				calls++
				deadline, ok := req.Context().Deadline()
				if !ok || time.Until(deadline) > turnstileVerifyTimeout {
					t.Fatal("verification request lacks the bounded timeout")
				}
				switch failure {
				case "network":
					return nil, errors.New("fixture transport unavailable")
				case "canceled":
					if !errors.Is(req.Context().Err(), context.Canceled) {
						t.Fatal("request cancellation did not reach Siteverify")
					}
					return nil, req.Context().Err()
				case "status":
					return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader(`{"success":true}`)), Header: make(http.Header)}, nil
				default:
					return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("invalid response")), Header: make(http.Header)}, nil
				}
			})})
			var appErr *kernel.AppError
			err := svc.VerifyTurnstile(ctx, "fixture-token", "192.0.2.1")
			if !errors.As(err, &appErr) || appErr.Status != http.StatusServiceUnavailable || calls != 1 {
				t.Fatalf("verification failure did not fail closed: calls=%d err=%v", calls, err)
			}
		})
	}
}

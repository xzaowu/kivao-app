package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestDeclarativeProtocolLateMediaLifecycle(t *testing.T) {
	allowLoopbackProviderTest(t)
	for _, tc := range []struct {
		name, mode                           string
		detached, noTask, noPoll, resultOnly bool
		neverReady                           bool
	}{
		{name: "image", mode: "image"},
		{name: "audio", mode: "audio"},
		{name: "detached video", mode: "video", detached: true},
		{name: "detached image", mode: "image", detached: true},
		{name: "missing task ID", mode: "video", noTask: true},
		{name: "no query endpoint", mode: "video", noPoll: true},
		{name: "dedicated result endpoint", mode: "video", resultOnly: true},
		{name: "bounded wait", mode: "video", neverReady: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			poll := `,"poll":{"method":"GET","path":"/tasks/{{taskId}}"}`
			if tc.noPoll {
				poll = ""
			}
			resultEndpoint := ""
			if tc.resultOnly {
				resultEndpoint = `,"result":{"method":"GET","path":"/media"}`
			}
			manifest := fmt.Sprintf(`{"apiVersion":"yingce.plugin/v1","id":"late-media","version":"1.0.0","name":"Late Media","author":"Test","documentation":"# Test","contributes":{"providers":[{"id":"late-media","label":"Late Media","capabilities":[%q],"scopes":["canvas"],"detachedPolling":%t,"create":{"method":"POST","path":"/tasks"}%s%s,"response":{"taskIdPaths":["id"],"statusPaths":["status"],"resultPaths":["media_url"],"resultKind":%q}}]}}`, tc.mode, tc.detached, poll, resultEndpoint, tc.mode)
			adapter, err := protocol.LoadManifest([]byte(manifest))
			if err != nil {
				t.Fatal(err)
			}
			var creates, polls, downloads atomic.Int32
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "POST /v1/tasks":
					creates.Add(1)
					id := "original-task"
					if tc.noTask {
						id = ""
					}
					_, _ = fmt.Fprintf(w, `{"id":%q,"status":"completed"}`, id)
				case "GET /v1/tasks/original-task":
					n := polls.Add(1)
					url := ""
					if n >= 2 && !tc.neverReady {
						url = server.URL + "/v1/media"
					}
					_, _ = fmt.Fprintf(w, `{"id":"original-task","status":"completed","media_url":%q}`, url)
				case "GET /v1/media":
					downloads.Add(1)
					w.Header().Set("Content-Type", map[string]string{"image": "image/png", "video": "video/mp4", "audio": "audio/mpeg"}[tc.mode])
					_, _ = w.Write([]byte("synthetic media transport fixture"))
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			input := canvasGenerationInput{Mode: tc.mode, Config: providerConfig{BaseURL: server.URL + "/v1", InterfaceType: "late-media"}}
			policy := fastVideoPollPolicy()
			if tc.neverReady {
				attempts := 0
				policy.Sleep = func(context.Context, time.Duration) error {
					attempts++
					if attempts > 3 {
						return context.DeadlineExceeded
					}
					return nil
				}
			}
			output, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
			if tc.detached {
				var pending providerStatePendingError
				if output != nil || !errors.As(err, &pending) || !pending.Detached || pending.TaskID != "original-task" || polls.Load() != 0 {
					t.Fatalf("create must retain accepted task for later polling: output=%v err=%v", output, err)
				}
				ctx = withProviderAnalytics(ctx, nil, model.Task{ID: "local-task", Type: "canvas_" + tc.mode, ProviderRequestID: pending.TaskID})
				output, err = runProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
				if output != nil || !errors.As(err, &pending) || !pending.Detached || pending.TaskID != "original-task" || polls.Load() != 1 {
					t.Fatalf("empty completed result must keep the same pending task: output=%v err=%v", output, err)
				}
				output, err = runProtocolAdapterTaskWithPolicy(ctx, input, adapter, policy)
			}
			switch {
			case tc.noTask || tc.noPoll:
				if output != nil || err == nil || !strings.Contains(err.Error(), "没有返回") || polls.Load() != 0 || downloads.Load() != 0 {
					t.Fatalf("unqueryable empty success must fail without fabrication: output=%v err=%v", output, err)
				}
			case tc.neverReady:
				if output != nil || !errors.Is(err, context.DeadlineExceeded) || polls.Load() != 3 || downloads.Load() != 0 {
					t.Fatalf("missing media must stop at polling deadline: output=%v err=%v polls=%d", output, err, polls.Load())
				}
			default:
				wantPolls := int32(2)
				if tc.resultOnly {
					wantPolls = 0
				}
				if err != nil || output["mode"] != tc.mode || polls.Load() != wantPolls || downloads.Load() != 1 {
					t.Fatalf("output=%v err=%v polls=%d downloads=%d", output, err, polls.Load(), downloads.Load())
				}
			}
			if creates.Load() != 1 {
				t.Fatalf("task was resubmitted: %d creates", creates.Load())
			}
		})
	}
}

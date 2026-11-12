package protocol

import (
	"path"
	"strings"
)

// Only static relative POST paths declare a reusable text wire. Templates and
// ambiguous paths still belong to the plugin's own request/response mapper.
func OperationPostPath(operation string) string {
	method, value, ok := strings.Cut(operation, " ")
	if !ok || method != "POST" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "?#%{}\\ \t\r\n\x00") || path.Clean(value) != value {
		return ""
	}
	return value
}

func TextWireForOperation(operation string) string {
	value := OperationPostPath(operation)
	for _, endpoint := range []struct{ path, wire string }{
		{"/chat/completions", "chat-completion"},
		{"/responses", "responses"},
		{"/messages", "claude-api"},
	} {
		if strings.HasSuffix(value, endpoint.path) {
			return endpoint.wire
		}
	}
	return ""
}

func StaticProxyPostPaths(adapter Adapter) []string {
	manifest, ok := adapter.(manifestAdapter)
	if !ok {
		return nil
	}
	operations := []ManifestOperation{manifest.manifest.Create}
	if manifest.manifest.Agent != nil {
		operations = append(operations, *manifest.manifest.Agent)
	}
	var paths []string
	for _, operation := range operations {
		if operation.PathTemplate != nil || operation.OriginPath {
			continue
		}
		if value := OperationPostPath(operationSummary(operation)); value != "" {
			paths = append(paths, value)
		}
	}
	return paths
}

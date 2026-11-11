package repository

import "testing"

func TestAgentJournalJSONNumericRoundTrip(t *testing.T) {
	for _, tc := range []struct {
		left, right string
		equal       bool
	}{
		{`{"x":4140.7990379296753}`, `{"x":4140.799037929675}`, true},
		{`{"x":[0.0,1e3]}`, `{"x":[0,1000]}`, true},
		{`{"x":9007199254740993}`, `{"x":9007199254740992}`, false},
		{`{"x":1.25}`, `{"x":1.26}`, false},
		{`{"x":1}`, `{"x":"1"}`, false},
		{`{"x":0.5}`, `{"x":"1/2"}`, false},
	} {
		if got := sameJSONDocument(tc.left, tc.right); got != tc.equal {
			t.Fatalf("comparison %s / %s = %t", tc.left, tc.right, got)
		}
	}
}

package skills

import "testing"

func TestParseSkillPackageMetadataBlockScalar(t *testing.T) {
	cases := []struct{ name, md, want string }{
		{"literal", "---\nname: a\ndescription: |\n  第一行\n  第二行\nmetadata:\n  version: 1\n---\nbody", "第一行 第二行"},
		{"folded", "---\nname: a\ndescription: >\n  折叠\n  成一行\n---\nbody", "折叠 成一行"},
		{"strip", "---\nname: a\ndescription: |-\n  单行\n---\nbody", "单行"},
		{"inline", "---\nname: a\ndescription: 普通简介\n---\nbody", "普通简介"},
		{"inline-quoted", "---\nname: a\ndescription: \"带引号\"\n---\nbody", "带引号"},
		{"block-then-name", "---\ndescription: |\n  三行\n  版本\nname: zz\n---\nbody", "三行 版本"},
		{"empty-block", "---\ndescription: |\nname: zz\nmetadata:\n  version: 1\n---\nbody", "body"},
	}
	for _, c := range cases {
		got := parseSkillPackageMetadata([]byte(c.md)).Description
		if got != c.want {
			t.Fatalf("%s: got %q want %q", c.name, got, c.want)
		}
	}
}

func TestBlockScalarPreservesFollowingMetadata(t *testing.T) {
	got := parseSkillPackageMetadata([]byte("---\r\ndescription: >-\r\n  第一行\r\n  第二行\r\nname: demo\r\nmetadata:\r\n  version: 2\r\n---\r\n正文"))
	if got.Name != "demo" || got.Version != "2" || got.Description != "第一行 第二行" {
		t.Fatalf("metadata not preserved: %#v", got)
	}
}

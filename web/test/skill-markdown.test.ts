import { describe, expect, test } from "bun:test";

import { skillMarkdownBody } from "../src/lib/skills/skill-markdown";

describe("技能阅读预览", () => {
    const body = "# 导演分镜\n\n阅读[参考文档](https://example.test/guide)。\n\n```yaml\nname: 正文代码\n```\n\n---\n\n正文分隔线。\n";

    test("隐藏整个嵌套元数据头，保留正文链接、代码和分隔线", () => {
        const source = '---\nname: 导演分镜\ndescription: |\n  多行简介\nmetadata:\n  version: "1.0.0"\n  authorAvatarUrl: https://example.test/avatar\n  showcaseMedia: [{type: video, showcase_url: https://example.test/demo}]\n---\n' + body;
        expect(skillMarkdownBody(source)).toBe(body);
        expect(source).toContain("authorAvatarUrl");
    });

    test("支持 BOM、CRLF 和 YAML 结束标记", () => {
        expect(skillMarkdownBody("\uFEFF---\r\nname: 示例\r\n...\r\n" + body)).toBe(body);
        expect(skillMarkdownBody("---\nname: 示例\n---")).toBe("");
    });

    test("未闭合头部不丢失原文", () => {
        const source = "---\nname: 示例\n\n# 正文\n";
        expect(skillMarkdownBody(source)).toBe(source);
    });

    test("普通正文、文件中部元数据及代码围栏保持原样", () => {
        for (const source of [body, "# 文档\n\n---\nname: 正文参数\n---\n", "```yaml\n---\nname: 代码示例\n---\n```", "---\n介绍文字\n---\n" + body]) {
            expect(skillMarkdownBody(source)).toBe(source);
        }
    });
});

// 只在阅读预览中去掉文件开头已闭合的元数据，编辑和下载仍使用原文。
export function skillMarkdownBody(source: string): string {
    const header = /^\uFEFF?[ \t]*---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source);
    if (!header || !/^[A-Za-z_][\w-]*[ \t]*:/m.test(header[1])) return source;
    return source.slice(header[0].length);
}

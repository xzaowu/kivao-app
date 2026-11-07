import { useEffect, useState } from "react";
import { Alert, App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";
import { Select } from "@/components/ui/base/select";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { fallbackSkillCategories, skillReviewLabels } from "@/pages/skills/skill-catalog";
import { getSkill, listAdminSkills, reviewSkill, type Skill } from "@/services/api/skills";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "./components/admin-ui";

export default function SkillReviewPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [status, setStatus] = useState(2);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState<Skill | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");
        listAdminSkills({ status, search, page, pageSize: 20 })
            .then((result) => {
                if (!cancelled) {
                    setSkills(result.skills);
                    setTotal(result.totalCount);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "技能审核列表加载失败");
                    setSkills([]);
                    setTotal(0);
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [status, search, page, retry]);

    const inspect = async (skill: Skill) => {
        setBusy(true);
        try {
            setSelected((await getSkill(skill.skillId)).skill);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "技能读取失败");
        } finally {
            setBusy(false);
        }
    };
    const review = async (action: "approve" | "reject" | "offline") => {
        if (!selected || busy) return;
        setBusy(true);
        try {
            await reviewSkill(selected, action);
            message.success(action === "approve" ? "技能已通过审核并上架" : action === "reject" ? "已拒绝公开申请" : "技能已下架");
            setSelected(null);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "操作失败，请刷新后重试");
            setSelected(null);
        } finally {
            setBusy(false);
            setRetry((value) => value + 1);
        }
    };
    const columns: ColumnsType<Skill> = [
        {
            title: "技能",
            dataIndex: "skillName",
            key: "name",
            render: (_, skill) => (
                <div>
                    <strong>{skill.skillName}</strong>
                    <p className="mt-1 text-xs text-foreground/65">{skill.description}</p>
                </div>
            ),
        },
        {
            title: "来源 / 作者",
            key: "author",
            width: 180,
            render: (_, skill) => (
                <div>
                    {skill.sourceType === "builtin" ? "内置技能" : "用户技能"}
                    <p className="text-xs text-foreground/65">{skill.effectiveUser.name || "未知作者"}</p>
                </div>
            ),
        },
        { title: "状态", dataIndex: "status", key: "status", width: 100, render: (value: number) => <AdminStatusBadge label={skillReviewLabels[value] || "未知"} tone={value === 1 ? "success" : value === 2 ? "warning" : "neutral"} /> },
        {
            title: "操作",
            key: "action",
            width: 135,
            render: (_, skill) => (
                <Button disabled={busy} onClick={() => void inspect(skill)}>
                    查看并管理
                </Button>
            ),
        },
    ];
    return (
        <AdminPageFrame
            title="技能审核"
            description="申请公开的技能经审核后上架；修改内容后重新审核。下架后其他用户不能查看、加入或通过 Agent 使用，作者仍可自用。"
            actions={
                <Button icon={<RefreshCw className="size-4" />} onClick={() => setRetry((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            {error ? <Alert type="error" showIcon title={error} /> : null}
            <AdminDataTable
                toolbar={
                    <div className="flex flex-wrap gap-3">
                        <Select
                            ariaLabel="审核状态"
                            value={status}
                            className="min-w-32"
                            options={[{ value: 0, label: "全部状态" }, ...Object.entries(skillReviewLabels).map(([value, label]) => ({ value: Number(value), label }))]}
                            onChange={(value: number) => {
                                setStatus(value);
                                setPage(1);
                            }}
                        />
                        <Input.Search
                            className="w-full sm:max-w-64"
                            aria-label="搜索技能"
                            placeholder="搜索技能名称"
                            maxLength={100}
                            allowClear
                            onSearch={(value) => {
                                setSearch(value);
                                setPage(1);
                            }}
                        />
                    </div>
                }
                table={{ rowKey: "skillId", columns, dataSource: skills, loading, pagination: false, scroll: { x: 700 } }}
                empty={<AdminTableEmpty title="暂无匹配技能" description="用户提交的公开申请将出现在待审核列表中。" />}
                footer={<PaginationBar current={page} pageSize={20} total={total} pageSizeOptions={[20]} onChange={setPage} />}
            />
            <SkillDetailModal
                skill={selected}
                loading={false}
                mutating={busy}
                categories={fallbackSkillCategories}
                onClose={() => {
                    if (!busy) setSelected(null);
                }}
                onAdd={() => {}}
                onLike={() => {}}
                onEdit={() => {}}
                onSync={() => {}}
                onOpenWorkbench={(skill) => navigate(`/skills/${encodeURIComponent(skill.skillId)}/edit`)}
                reviewActions={
                    <>
                        {selected?.status !== 1 ? (
                            <Button type="primary" loading={busy} onClick={() => void review("approve")}>
                                {selected?.status === 2 ? "审核通过并上架" : "重新审核并上架"}
                            </Button>
                        ) : null}
                        {selected?.status === 2 ? (
                            <Button danger disabled={busy} onClick={() => void review("reject")}>
                                不通过
                            </Button>
                        ) : null}
                        {selected?.status === 1 ? (
                            <Button danger loading={busy} onClick={() => void review("offline")}>
                                下架
                            </Button>
                        ) : null}
                    </>
                }
            />
        </AdminPageFrame>
    );
}

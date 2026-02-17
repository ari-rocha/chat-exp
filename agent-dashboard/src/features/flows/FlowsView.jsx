import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Background,
  ConnectionLineType,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Code2,
  Copy,
  Eye,
  FileText,
  Globe,
  GripVertical,
  Hash,
  Image,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Star,
  StickyNote,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  Workflow,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

/* ─── node type config & helpers ──────────────────────────── */

const NODE_COLORS = {
  start: {
    bg: "#eef4ff",
    border: "#bfdbfe",
    icon: "#3b82f6",
    iconBg: "#dbeafe",
  },
  llm: { bg: "#faf5ff", border: "#e9d5ff", icon: "#8b5cf6", iconBg: "#ede9fe" },
  question_classifier: {
    bg: "#eef4ff",
    border: "#bfdbfe",
    icon: "#3b82f6",
    iconBg: "#dbeafe",
  },
  http: {
    bg: "#fff7ed",
    border: "#fed7aa",
    icon: "#f97316",
    iconBg: "#ffedd5",
  },
  code: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    icon: "#10b981",
    iconBg: "#d1fae5",
  },
  end: { bg: "#fef2f2", border: "#fecaca", icon: "#ef4444", iconBg: "#fee2e2" },
  condition: {
    bg: "#fffbeb",
    border: "#fde68a",
    icon: "#f59e0b",
    iconBg: "#fef3c7",
  },
  message: {
    bg: "#f0f9ff",
    border: "#bae6fd",
    icon: "#0ea5e9",
    iconBg: "#e0f2fe",
  },
  ai: { bg: "#eef4ff", border: "#bfdbfe", icon: "#3b82f6", iconBg: "#dbeafe" },
  trigger: {
    bg: "#eef4ff",
    border: "#bfdbfe",
    icon: "#3b82f6",
    iconBg: "#dbeafe",
  },
  buttons: {
    bg: "#f0f9ff",
    border: "#bae6fd",
    icon: "#0ea5e9",
    iconBg: "#e0f2fe",
  },
  carousel: {
    bg: "#f0f9ff",
    border: "#bae6fd",
    icon: "#0ea5e9",
    iconBg: "#e0f2fe",
  },
  select: {
    bg: "#f0f9ff",
    border: "#bae6fd",
    icon: "#0ea5e9",
    iconBg: "#e0f2fe",
  },
  input_form: {
    bg: "#f5f3ff",
    border: "#ddd6fe",
    icon: "#7c3aed",
    iconBg: "#ede9fe",
  },
  quick_input: {
    bg: "#f5f3ff",
    border: "#ddd6fe",
    icon: "#7c3aed",
    iconBg: "#ede9fe",
  },
  wait: {
    bg: "#fffbeb",
    border: "#fde68a",
    icon: "#d97706",
    iconBg: "#fef3c7",
  },
  assign: {
    bg: "#f0fdf4",
    border: "#bbf7d0",
    icon: "#16a34a",
    iconBg: "#dcfce7",
  },
  close_conversation: {
    bg: "#fef2f2",
    border: "#fecaca",
    icon: "#dc2626",
    iconBg: "#fee2e2",
  },
  csat: {
    bg: "#fffbeb",
    border: "#fde68a",
    icon: "#eab308",
    iconBg: "#fef9c3",
  },
  tag: {
    bg: "#fdf4ff",
    border: "#f0abfc",
    icon: "#c026d3",
    iconBg: "#fae8ff",
  },
  set_attribute: {
    bg: "#f0fdfa",
    border: "#99f6e4",
    icon: "#0d9488",
    iconBg: "#ccfbf1",
  },
  note: {
    bg: "#fefce8",
    border: "#fef08a",
    icon: "#ca8a04",
    iconBg: "#fef9c3",
  },
  webhook: {
    bg: "#fff7ed",
    border: "#fed7aa",
    icon: "#ea580c",
    iconBg: "#ffedd5",
  },
  start_flow: {
    bg: "#f0fdfa",
    border: "#5eead4",
    icon: "#0d9488",
    iconBg: "#ccfbf1",
  },
};

const NODE_ICONS = {
  start: Zap,
  llm: Brain,
  question_classifier: Sparkles,
  http: Globe,
  code: Code2,
  end: CircleDot,
  condition: RefreshCw,
  message: MessageSquare,
  ai: Sparkles,
  trigger: Zap,
  buttons: Puzzle,
  carousel: Image,
  select: FileText,
  input_form: FileText,
  quick_input: Pencil,
  wait: Clock,
  assign: UserPlus,
  close_conversation: XCircle,
  csat: Star,
  tag: Tag,
  set_attribute: Hash,
  note: StickyNote,
  webhook: Send,
  start_flow: Workflow,
};

function displayTypeLabel(type) {
  if (type === "ai" || type === "question_classifier")
    return "QUESTION CLASSIFIER";
  if (type === "llm") return "LLM";
  if (type === "http") return "HTTP REQUEST";
  if (type === "code") return "CODE";
  if (type === "start") return "START";
  if (type === "end") return "END";
  if (type === "input_form") return "INPUT FORM";
  if (type === "quick_input") return "QUICK INPUT";
  if (type === "condition") return "IF / ELSE";
  if (type === "trigger") return "TRIGGER";
  if (type === "close_conversation") return "CLOSE CONVERSATION";
  if (type === "set_attribute") return "SET ATTRIBUTE";
  if (type === "csat") return "CSAT RATING";
  if (type === "start_flow") return "START FLOW";
  return type.replace(/_/g, " ").toUpperCase();
}

function outputPorts(type, data) {
  if (type === "condition") {
    const custom = Array.isArray(data?.outputs)
      ? data.outputs.filter(Boolean)
      : [];
    if (custom.length > 0)
      return [
        ...custom.map((label, index) => ({ id: `out-${index}`, label })),
        { id: "else", label: "Else" },
      ];
    return [
      { id: "true", label: "Yes" },
      { id: "else", label: "Else" },
    ];
  }

  if (
    (type === "ai" || type === "question_classifier") &&
    Array.isArray(data?.classes) &&
    data.classes.length > 1
  ) {
    return data.classes.map((label, index) => ({
      id: `class-${index}`,
      label: `CLASS ${index + 1}`,
    }));
  }

  if (
    type === "buttons" &&
    Array.isArray(data?.buttons) &&
    data.buttons.length > 0
  ) {
    return data.buttons.map((label, index) => ({
      id: `btn-${index}`,
      label: label || `Button ${index + 1}`,
    }));
  }

  if (
    type === "select" &&
    Array.isArray(data?.options) &&
    data.options.length > 0
  ) {
    return data.options.map((label, index) => ({
      id: `opt-${index}`,
      label: label || `Option ${index + 1}`,
    }));
  }

  return [];
}

/* ─── Dify-style Card Node ────────────────────────────────── */

function DifyNode({ data, type, selected }) {
  const colors = NODE_COLORS[type] || NODE_COLORS.message;
  const IconComp = NODE_ICONS[type] || Bot;
  const outputs = outputPorts(type, data);
  const isStart = type === "start" || type === "trigger";
  const isClassifier =
    (type === "ai" || type === "question_classifier") && outputs.length > 0;
  const hasMultiOutputs = outputs.length > 0;

  return (
    <div
      className={`relative min-w-[220px] max-w-[280px] rounded-2xl border-[1.5px] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all ${
        selected ? "ring-2 ring-blue-400 ring-offset-2" : ""
      }`}
      style={{ borderColor: colors.border, backgroundColor: "#fff" }}
    >
      {/* Target handle */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Left}
          className="!-left-[5px] !h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
        />
      )}

      {/* ── Header ── */}
      <div
        className={`flex items-center gap-2.5 px-3 py-2.5 ${type === "end" ? "rounded-[14px]" : "rounded-t-[14px]"}`}
        style={{ backgroundColor: colors.bg }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: colors.iconBg }}
        >
          <IconComp size={15} style={{ color: colors.icon }} />
        </div>
        <span className="flex-1 text-[13px] font-semibold text-slate-800 leading-tight">
          {displayTypeLabel(type)}
        </span>
        <button className="rounded p-0.5 text-slate-400 hover:bg-white/50 hover:text-slate-600">
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* ── Body ── */}
      {type !== "end" && (
        <div className="px-3 py-2.5 text-[11px]">
          {/* START / TRIGGER body */}
          {isStart && (
            <div className="space-y-1.5">
              {data?.on && (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold text-blue-600">
                    {{
                      widget_open: "Widget opens",
                      page_open: "Page opens",
                      first_message: "First message",
                      any_message: "Any message",
                      conversation_closed: "Conversation closed",
                      conversation_reopened: "Conversation reopened",
                    }[data.on] || data.on}
                  </span>
                </div>
              )}
              {Array.isArray(data?.fields) && data.fields.length > 0 ? (
                <>
                  {data.fields.map((field, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-600">
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-500">
                          {"{x}"}
                        </span>
                        {field.label || field.name}
                      </span>
                      <div className="flex items-center gap-1">
                        {field.required && (
                          <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-orange-600">
                            Required
                          </span>
                        )}
                        <GripVertical size={10} className="text-slate-300" />
                      </div>
                    </div>
                  ))}
                  <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                    Define the initial parameters for launching a workflow
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-slate-400">
                  Define the initial parameters for launching a workflow
                </p>
              )}
            </div>
          )}

          {/* LLM body */}
          {type === "llm" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-100">
                  <Bot size={11} className="text-emerald-600" />
                </div>
                <span className="text-[12px] font-medium text-slate-700">
                  GPT-4o
                </span>
              </div>
              <p className="leading-relaxed text-slate-500">
                {data?.text ||
                  "Invoking large language models to answer questions or process natural language"}
              </p>
            </div>
          )}

          {/* CLASSIFIER body */}
          {isClassifier && (
            <div className="space-y-1.5">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded bg-emerald-100">
                  <Bot size={11} className="text-emerald-600" />
                </div>
                <span className="text-[12px] font-medium text-slate-700">
                  GPT-4o
                </span>
              </div>
              {(data?.classes || []).map((cls, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-px font-bold text-slate-500 whitespace-nowrap">
                    CLASS {i + 1}
                  </span>
                  <span className="text-slate-600 leading-snug">{cls}</span>
                </div>
              ))}
            </div>
          )}

          {/* HTTP body */}
          {type === "http" && (
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                POST
              </span>
              <span className="truncate text-slate-500">
                {data?.url || "https://api.example.com/..."}
              </span>
            </div>
          )}

          {/* CODE body */}
          {type === "code" && (
            <p className="text-slate-500">
              {data?.text || "Custom code execution"}
            </p>
          )}

          {/* BUTTONS body */}
          {type === "buttons" && (
            <div className="space-y-1">
              {data?.text && (
                <p className="text-slate-500 mb-1.5">{data.text}</p>
              )}
              {(data?.buttons || []).map((btn, i) => (
                <div
                  key={i}
                  className="relative flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-2.5 py-1.5"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sky-200/70 text-[9px] font-bold text-sky-700">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-[11px] font-medium text-slate-700">
                    {btn || `Button ${i + 1}`}
                  </span>
                  <Handle
                    type="source"
                    id={`btn-${i}`}
                    position={Position.Right}
                    className="!-right-[5px] !h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
                  />
                </div>
              ))}
            </div>
          )}

          {/* SELECT body */}
          {type === "select" && (
            <div className="space-y-1">
              {data?.text && (
                <p className="text-slate-500 mb-1.5">{data.text}</p>
              )}
              {(data?.options || []).map((opt, i) => (
                <div
                  key={i}
                  className="relative flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-2.5 py-1.5"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sky-200/70 text-[9px] font-bold text-sky-700">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-[11px] font-medium text-slate-700">
                    {opt || `Option ${i + 1}`}
                  </span>
                  <Handle
                    type="source"
                    id={`opt-${i}`}
                    position={Position.Right}
                    className="!-right-[5px] !h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
                  />
                </div>
              ))}
            </div>
          )}

          {/* INPUT_FORM body */}
          {type === "input_form" && (
            <div className="space-y-1">
              {data?.text && <p className="text-slate-500 mb-1">{data.text}</p>}
              {(data?.fields || []).map((f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-500 whitespace-nowrap text-[10px]">
                    {(f.type || "text").toUpperCase()}
                  </span>
                  <span className="text-slate-600 truncate">
                    {f.label || f.name || `Field ${i + 1}`}
                  </span>
                  {f.required && (
                    <span className="text-red-400 text-[9px]">*</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* WAIT body */}
          {type === "wait" && (
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-amber-500" />
              <span className="text-slate-600">
                {data?.duration || 60} {data?.unit || "seconds"}
              </span>
            </div>
          )}

          {/* ASSIGN body */}
          {type === "assign" && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <UserPlus size={12} className="text-green-500" />
                <span className="text-slate-600">
                  {data?.assignTo === "agent" ? "Agent" : "Team"}:{" "}
                  <span className="font-medium">
                    {(data?.assignTo === "agent"
                      ? data?.agentEmail
                      : data?.teamName) || "Not set"}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* CLOSE CONVERSATION body */}
          {type === "close_conversation" && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <XCircle size={12} className="text-red-500" />
                <span className="text-slate-600">Close conversation</span>
              </div>
              {data?.sendCsat && (
                <span className="text-[10px] text-amber-600 font-medium">
                  + CSAT survey
                </span>
              )}
            </div>
          )}

          {/* CSAT body */}
          {type === "csat" && (
            <div className="space-y-1">
              {data?.text && <p className="text-slate-500 mb-1">{data.text}</p>}
              <div className="flex items-center gap-0.5">
                {(data?.ratingType === "stars"
                  ? ["⭐", "⭐", "⭐", "⭐", "⭐"]
                  : ["😡", "😟", "😐", "😊", "😍"]
                ).map((e, i) => (
                  <span key={i} className="text-[14px]">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* TAG body */}
          {type === "tag" && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-purple-600 uppercase">
                {data?.action === "remove" ? "Remove" : "Add"} tags
              </span>
              <div className="flex flex-wrap gap-1">
                {(data?.tags || []).filter(Boolean).map((t, i) => (
                  <span
                    key={i}
                    className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* SET_ATTRIBUTE body */}
          {type === "set_attribute" && (
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-teal-600 uppercase">
                {data?.target || "contact"}
              </span>
              <div className="flex items-center gap-1">
                <span className="font-medium text-slate-700 truncate">
                  {data?.attributeName || "attribute"}
                </span>
                <span className="text-slate-400">=</span>
                <span className="text-slate-600 truncate">
                  {data?.attributeValue || "value"}
                </span>
              </div>
            </div>
          )}

          {/* NOTE body */}
          {type === "note" && (
            <div className="flex items-start gap-1.5">
              <StickyNote
                size={12}
                className="text-yellow-600 mt-0.5 shrink-0"
              />
              <p className="text-slate-600 line-clamp-2">
                {data?.text || "Internal note"}
              </p>
            </div>
          )}

          {/* WEBHOOK body */}
          {type === "webhook" && (
            <div className="flex items-center gap-2">
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
                {data?.method || "POST"}
              </span>
              <span className="truncate text-slate-500">
                {data?.url || "https://hooks.example.com/..."}
              </span>
            </div>
          )}

          {/* CONDITION body */}
          {type === "condition" &&
            (() => {
              const condOutputs = outputPorts(type, data);
              return (
                <div className="space-y-1">
                  {/* Rule summary */}
                  {(data?.rules || []).length > 0 && (
                    <div className="mb-1.5 rounded-lg border border-amber-200/60 bg-amber-50/40 px-2 py-1.5">
                      {data.rules.map((rule, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1 text-[10px]"
                        >
                          {i > 0 && (
                            <span className="rounded bg-amber-200 px-1 py-0.5 text-[8px] font-bold text-amber-700 uppercase">
                              {data?.logicOperator || "and"}
                            </span>
                          )}
                          <span className="font-medium text-slate-700 truncate">
                            {rule.attribute || "message"}
                          </span>
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700">
                            {rule.operator || "equals"}
                          </span>
                          <span className="text-slate-500 truncate">
                            {rule.value || "…"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Branch cards with handles */}
                  {condOutputs.map((branch) => {
                    const isElse = branch.id === "else";
                    return (
                      <div
                        key={branch.id}
                        className={`relative flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                          isElse
                            ? "border-slate-200 bg-slate-50"
                            : "border-emerald-200 bg-emerald-50/60"
                        }`}
                      >
                        <span
                          className={`flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[9px] font-bold uppercase ${
                            isElse
                              ? "bg-slate-200/70 text-slate-600"
                              : "bg-emerald-200/70 text-emerald-700"
                          }`}
                        >
                          {isElse ? "ELSE" : "THEN"}
                        </span>
                        <span className="flex-1 truncate text-[11px] font-medium text-slate-700">
                          {branch.label}
                        </span>
                        <Handle
                          type="source"
                          id={branch.id}
                          position={Position.Right}
                          className="!-right-[5px] !h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
                        />
                      </div>
                    );
                  })}
                  {condOutputs.length === 0 && (
                    <p className="text-[10px] text-slate-400">
                      No rules defined
                    </p>
                  )}
                </div>
              );
            })()}

          {/* Generic fallback body */}
          {!isStart &&
            type !== "llm" &&
            !isClassifier &&
            type !== "http" &&
            type !== "code" &&
            type !== "end" &&
            type !== "buttons" &&
            type !== "select" &&
            type !== "input_form" &&
            type !== "wait" &&
            type !== "assign" &&
            type !== "close_conversation" &&
            type !== "csat" &&
            type !== "tag" &&
            type !== "set_attribute" &&
            type !== "note" &&
            type !== "webhook" &&
            type !== "condition" && (
              <p className="text-slate-600 line-clamp-2">
                {data?.text || data?.label || ""}
              </p>
            )}
        </div>
      )}

      {/* ── Source handles ── */}
      {/* buttons, select, condition render their own inline handles */}
      {type !== "buttons" &&
        type !== "select" &&
        type !== "condition" &&
        (outputs.length > 0 ? (
          outputs.map((output, index) => {
            const top = `${((index + 1) / (outputs.length + 1)) * 100}%`;
            return (
              <div
                key={output.id}
                className="absolute -right-[5px]"
                style={{ top, transform: "translateY(-50%)" }}
              >
                <Handle
                  type="source"
                  id={output.id}
                  position={Position.Right}
                  className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
                />
              </div>
            );
          })
        ) : (
          <Handle
            type="source"
            position={Position.Right}
            className="!-right-[5px] !h-2.5 !w-2.5 !rounded-full !border-2 !border-white !bg-blue-500"
          />
        ))}
    </div>
  );
}

/* ─── Node types registry ─────────────────────────────────── */

const FLOW_NODE_TYPES = {
  trigger: DifyNode,
  condition: DifyNode,
  message: DifyNode,
  buttons: DifyNode,
  carousel: DifyNode,
  select: DifyNode,
  input_form: DifyNode,
  quick_input: DifyNode,
  ai: DifyNode,
  end: DifyNode,
  start: DifyNode,
  llm: DifyNode,
  question_classifier: DifyNode,
  http: DifyNode,
  code: DifyNode,
  wait: DifyNode,
  assign: DifyNode,
  close_conversation: DifyNode,
  csat: DifyNode,
  tag: DifyNode,
  set_attribute: DifyNode,
  note: DifyNode,
  webhook: DifyNode,
  start_flow: DifyNode,
};

/* ─── Variable Picker Dropdown ───────────────────────────── */

const CONTACT_VARIABLES = [
  { key: "contact.name", displayName: "Contact Name" },
  { key: "contact.email", displayName: "Contact Email" },
  { key: "contact.phone", displayName: "Contact Phone" },
  { key: "contact.company", displayName: "Contact Company" },
  { key: "contact.location", displayName: "Contact Location" },
];

function VariablePickerDropdown({
  attributeDefs,
  flowInputVariables,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const defs = attributeDefs || [];
  const flowVars = (flowInputVariables || []).filter((v) => v.key);

  const hasAnything =
    CONTACT_VARIABLES.length > 0 || flowVars.length > 0 || defs.length > 0;
  if (!hasAnything) return null;

  const renderGroup = (title, items, color) => {
    if (!items || items.length === 0) return null;
    return (
      <>
        <div className="px-2.5 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {title}
          </p>
        </div>
        {items.map((d) => (
          <button
            key={d.key}
            onClick={() => {
              onSelect(d.key);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50"
          >
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${color}`}
            >
              {d.key}
            </span>
            <span className="truncate text-[11px] text-slate-600">
              {d.displayName || d.label || d.key}
            </span>
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="absolute right-1.5 top-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="Insert variable"
      >
        <Code2 size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
            <div>
              {renderGroup(
                "Contact",
                CONTACT_VARIABLES,
                "bg-sky-100 text-sky-600",
              )}
            </div>
            {flowVars.length > 0 && (
              <div>
                {renderGroup(
                  "Flow Variables",
                  flowVars.map((v) => ({
                    key: v.key,
                    displayName: v.label || v.key,
                  })),
                  "bg-emerald-100 text-emerald-600",
                )}
              </div>
            )}
            {defs.length > 0 && (
              <div>
                {renderGroup(
                  "Custom Attributes",
                  defs,
                  "bg-violet-100 text-violet-600",
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Right Sidebar — Settings Panel ─────────────────────── */

function SettingsPanel({
  selectedNode,
  updateSelectedNodeData,
  removeSelectedNode,
  attributeDefs,
  setAttributeDefs,
  apiFetch,
  token,
  flows,
  activeFlowId,
  flowInputVariables,
  setFlowInputVariables,
}) {
  const [activeTab, setActiveTab] = useState("settings");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(true);
  const [resolution, setResolution] = useState("High");
  const [showNewAttrForm, setShowNewAttrForm] = useState(false);
  const [newAttrDisplayName, setNewAttrDisplayName] = useState("");
  const [newAttrKey, setNewAttrKey] = useState("");
  const [newAttrDesc, setNewAttrDesc] = useState("");
  const [newAttrModel, setNewAttrModel] = useState("contact");

  if (!selectedNode) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
          <Settings2 size={20} className="text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-600">No node selected</p>
        <p className="mt-1 text-xs text-slate-400">
          Click a node on the canvas to view and edit its configuration.
        </p>
      </div>
    );
  }

  const type = selectedNode.type;
  const data = selectedNode.data || {};
  const colors = NODE_COLORS[type] || NODE_COLORS.message;
  const IconComp = NODE_ICONS[type] || Bot;
  const isClassifier = type === "ai" || type === "question_classifier";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: colors.iconBg }}
          >
            <IconComp size={16} style={{ color: colors.icon }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              {displayTypeLabel(type)}
            </h3>
            <p className="text-[10px] text-slate-400">Add description...</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <MoreHorizontal size={14} />
          </button>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-4">
        {["settings", "lastrun"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-500 text-blue-600"
                : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {tab === "settings" ? "Settings" : "Last Run"}
          </button>
        ))}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="space-y-5 px-4 py-4">
          {/* ── Model ── */}
          {(isClassifier || type === "llm") && (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Model
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-100">
                  <Bot size={13} className="text-emerald-600" />
                </div>
                <span className="flex-1 text-[12px] font-medium text-slate-700">
                  GPT-4o
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                  CHAT
                </span>
                <div className="flex items-center gap-0.5 text-slate-400">
                  <button className="rounded p-0.5 hover:bg-slate-100">
                    <Copy size={11} />
                  </button>
                  <button className="rounded p-0.5 hover:bg-slate-100">
                    <Upload size={11} />
                  </button>
                  <button className="rounded p-0.5 hover:bg-slate-100">
                    <Copy size={11} />
                  </button>
                </div>
                <ChevronDown size={14} className="text-slate-400" />
              </div>
            </div>
          )}

          {/* ── Input Variables ── */}
          {isClassifier && (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Input Variables
              </label>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="text-slate-400">⊙</span>
                  <span className="font-medium text-blue-600">Start</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {"{x}"}
                  </span>
                  <span className="text-slate-600">location</span>
                  <span className="ml-auto text-[10px] text-slate-400">
                    string
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Vision ── */}
          {isClassifier && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Vision
                  </label>
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[8px] text-slate-400">
                    ?
                  </span>
                </div>
                <button
                  onClick={() => setVisionEnabled(!visionEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    visionEnabled ? "bg-blue-500" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                      visionEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                    }`}
                  />
                </button>
              </div>
              {visionEnabled && (
                <div className="space-y-2.5">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-slate-400">⊙</span>
                      <span className="font-medium text-blue-600">Start</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {"{x}"}
                      </span>
                      <span className="text-slate-600">sys.files</span>
                      <span className="ml-auto text-[10px] text-slate-400">
                        Array[File]
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">
                      Resolution
                    </span>
                    <div className="flex overflow-hidden rounded-lg border border-slate-200">
                      {["High", "Low"].map((r) => (
                        <button
                          key={r}
                          onClick={() => setResolution(r)}
                          className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                            resolution === r
                              ? "bg-slate-800 text-white"
                              : "bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Classes ── */}
          {isClassifier && (
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Class
              </label>
              <div className="space-y-3">
                {(data?.classes || []).map((cls, i) => (
                  <div
                    key={i}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-600">
                          CLASS {i + 1}
                        </span>
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 text-[8px] text-slate-400">
                          ?
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400">
                        <span className="text-[10px]">0</span>
                        <button className="rounded p-0.5 hover:bg-slate-100">
                          <Sparkles size={11} />
                        </button>
                        <button className="rounded p-0.5 hover:bg-slate-100">
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[8px] font-medium text-slate-500">
                            {"{x}"}
                          </span>
                        </button>
                        <button className="rounded p-0.5 hover:bg-slate-100">
                          <Trash2 size={11} />
                        </button>
                        <button className="rounded p-0.5 hover:bg-slate-100">
                          <Copy size={11} />
                        </button>
                        <button className="rounded p-0.5 hover:bg-slate-100">
                          <Eye size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <Textarea
                        rows={2}
                        className="min-h-[40px] border-0 bg-transparent p-0 text-[11px] text-slate-600 shadow-none focus-visible:ring-0 resize-none"
                        placeholder={`Write your class ${i + 1} here\nPress '/' to insert variable`}
                        value={cls}
                        onChange={(e) => {
                          const classes = [...(data.classes || [])];
                          classes[i] = e.target.value;
                          updateSelectedNodeData({ classes });
                        }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  onClick={() =>
                    updateSelectedNodeData({
                      classes: [...(data.classes || []), ""],
                    })
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                >
                  <Plus size={12} /> Add Class
                </button>
              </div>
            </div>
          )}

          {/* ── Advanced Settings ── */}
          {isClassifier && (
            <div>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
              >
                {advancedOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Advanced Settings
              </button>
              {advancedOpen && (
                <div className="mt-3 space-y-3">
                  <div className="overflow-hidden rounded-lg border border-blue-200 bg-blue-50/50">
                    <div className="flex items-center justify-between border-b border-blue-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-600">
                          INSTRUCTION
                        </span>
                        <span className="text-[10px] text-slate-400">128</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400">
                        <button className="rounded p-0.5 hover:bg-blue-100">
                          <Sparkles size={11} />
                        </button>
                        <button className="rounded p-0.5 hover:bg-blue-100">
                          <span className="rounded bg-white/60 px-1 py-0.5 text-[8px] font-medium text-slate-500">
                            {"{x}"}
                          </span>
                        </button>
                        <button className="rounded p-0.5 hover:bg-blue-100">
                          <Copy size={11} />
                        </button>
                        <button className="rounded p-0.5 hover:bg-blue-100">
                          <Eye size={11} />
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="relative">
                        <Textarea
                          rows={3}
                          className="min-h-[60px] border-0 bg-transparent p-0 pr-7 text-[11px] text-slate-600 shadow-none focus-visible:ring-0 resize-none"
                          value={
                            data?.prompt ||
                            "You are an entity extraction model that accepts an input text and ⊙ Start {x} type of entities to extract."
                          }
                          onChange={(e) =>
                            updateSelectedNodeData({ prompt: e.target.value })
                          }
                        />
                        <VariablePickerDropdown
                          attributeDefs={attributeDefs}
                          flowInputVariables={flowInputVariables}
                          onSelect={(varKey) => {
                            const cur = data?.prompt || "";
                            updateSelectedNodeData({
                              prompt: cur + `{{${varKey}}}`,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── LLM Settings ── */}
          {type === "llm" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Prompt
                </label>
                <div className="relative">
                  <Textarea
                    rows={4}
                    value={data?.prompt || data?.text || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ text: e.target.value })
                    }
                    placeholder="System prompt for the LLM"
                    className="pr-8 text-[12px]"
                  />
                  <VariablePickerDropdown
                    attributeDefs={attributeDefs}
                    flowInputVariables={flowInputVariables}
                    onSelect={(varKey) => {
                      const cur = data?.prompt || data?.text || "";
                      updateSelectedNodeData({ text: cur + `{{${varKey}}}` });
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Generic Node Settings ── */}
          {!isClassifier &&
            type !== "llm" &&
            type !== "start" &&
            type !== "trigger" && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Label
                  </label>
                  <Input
                    value={data?.label || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ label: e.target.value })
                    }
                    placeholder="Node label"
                    className="text-[12px]"
                  />
                </div>
                {(type === "message" ||
                  type === "buttons" ||
                  type === "carousel" ||
                  type === "select" ||
                  type === "input_form" ||
                  type === "quick_input") && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Text
                    </label>
                    <div className="relative">
                      <Textarea
                        rows={3}
                        value={data?.text || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({ text: e.target.value })
                        }
                        placeholder="Message text — use {{contact.name}} for variables"
                        className="pr-8 text-[12px]"
                      />
                      <VariablePickerDropdown
                        attributeDefs={attributeDefs}
                        flowInputVariables={flowInputVariables}
                        onSelect={(varKey) => {
                          const cur = data?.text || "";
                          updateSelectedNodeData({
                            text: cur + `{{${varKey}}}`,
                          });
                        }}
                      />
                    </div>
                  </div>
                )}
                {type === "buttons" && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Buttons
                    </label>
                    <div className="space-y-2">
                      {(data?.buttons || []).map((btn, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-sky-100 text-[10px] font-bold text-sky-600">
                            {i + 1}
                          </div>
                          <Input
                            value={btn}
                            onChange={(e) => {
                              const buttons = [...(data.buttons || [])];
                              buttons[i] = e.target.value;
                              updateSelectedNodeData({ buttons });
                            }}
                            placeholder={`Button ${i + 1}`}
                            className="flex-1 text-[12px]"
                          />
                          <button
                            onClick={() => {
                              const buttons = [...(data.buttons || [])];
                              buttons.splice(i, 1);
                              updateSelectedNodeData({ buttons });
                            }}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            buttons: [...(data.buttons || []), ""],
                          })
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Plus size={12} /> Add Button
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-[11px] font-medium text-slate-700">
                          Disable text composer
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Force user to use buttons only
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            disableComposer: !data?.disableComposer,
                          })
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data?.disableComposer ? "bg-blue-500" : "bg-slate-300"}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${data?.disableComposer ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                        />
                      </button>
                    </div>
                  </div>
                )}
                {type === "select" && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Options
                    </label>
                    <div className="space-y-2">
                      {(data?.options || []).map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-sky-100 text-[10px] font-bold text-sky-600">
                            {i + 1}
                          </div>
                          <Input
                            value={opt}
                            onChange={(e) => {
                              const options = [...(data.options || [])];
                              options[i] = e.target.value;
                              updateSelectedNodeData({ options });
                            }}
                            placeholder={`Option ${i + 1}`}
                            className="flex-1 text-[12px]"
                          />
                          <button
                            onClick={() => {
                              const options = [...(data.options || [])];
                              options.splice(i, 1);
                              updateSelectedNodeData({ options });
                            }}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            options: [...(data.options || []), ""],
                          })
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Plus size={12} /> Add Option
                      </button>
                    </div>
                  </div>
                )}
                {type === "condition" && (
                  <>
                    {/* Rules */}
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Rules
                      </label>
                      <div className="space-y-2">
                        {(data?.rules || []).map((rule, i) => (
                          <div
                            key={i}
                            className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                          >
                            {i > 0 && (
                              <div className="flex justify-center pb-1">
                                <select
                                  className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-700"
                                  value={data?.logicOperator || "and"}
                                  onChange={(e) =>
                                    updateSelectedNodeData({
                                      logicOperator: e.target.value,
                                    })
                                  }
                                >
                                  <option value="and">AND</option>
                                  <option value="or">OR</option>
                                </select>
                              </div>
                            )}
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
                              value={rule.attribute || "message"}
                              onChange={(e) => {
                                const rules = [...(data.rules || [])];
                                rules[i] = {
                                  ...rules[i],
                                  attribute: e.target.value,
                                };
                                updateSelectedNodeData({ rules });
                              }}
                            >
                              <optgroup label="Conversation">
                                <option value="message">Last message</option>
                                <option value="channel">Channel</option>
                                <option value="status">Status</option>
                                <option value="priority">Priority</option>
                                <option value="assignee">Assignee</option>
                                <option value="team">Team</option>
                                <option value="inbox">Inbox</option>
                              </optgroup>
                              <optgroup label="Contact">
                                <option value="contact.identified">
                                  Identified
                                </option>
                                <option value="contact.email">Email</option>
                                <option value="contact.name">Name</option>
                                <option value="contact.phone">Phone</option>
                                <option value="contact.company">Company</option>
                                <option value="contact.location">
                                  Location
                                </option>
                              </optgroup>
                              <optgroup label="Custom">
                                <option value="contact_attribute">
                                  Contact attribute…
                                </option>
                                <option value="conversation_attribute">
                                  Conversation attribute…
                                </option>
                              </optgroup>
                              {(attributeDefs || []).filter(
                                (d) => d.attributeModel === "contact",
                              ).length > 0 && (
                                <optgroup label="Contact Custom Attributes">
                                  {(attributeDefs || [])
                                    .filter(
                                      (d) => d.attributeModel === "contact",
                                    )
                                    .map((d) => (
                                      <option
                                        key={d.key}
                                        value={`contact_attr.${d.key}`}
                                      >
                                        {d.displayName}
                                      </option>
                                    ))}
                                </optgroup>
                              )}
                              {(attributeDefs || []).filter(
                                (d) => d.attributeModel === "conversation",
                              ).length > 0 && (
                                <optgroup label="Conversation Custom Attributes">
                                  {(attributeDefs || [])
                                    .filter(
                                      (d) =>
                                        d.attributeModel === "conversation",
                                    )
                                    .map((d) => (
                                      <option
                                        key={d.key}
                                        value={`conv_attr.${d.key}`}
                                      >
                                        {d.displayName}
                                      </option>
                                    ))}
                                </optgroup>
                              )}
                            </select>
                            {(rule.attribute === "contact_attribute" ||
                              rule.attribute === "conversation_attribute") && (
                              <Input
                                value={rule.attributeKey || ""}
                                onChange={(e) => {
                                  const rules = [...(data.rules || [])];
                                  rules[i] = {
                                    ...rules[i],
                                    attributeKey: e.target.value,
                                  };
                                  updateSelectedNodeData({ rules });
                                }}
                                placeholder="Attribute key"
                                className="text-[11px]"
                              />
                            )}
                            <div className="grid grid-cols-2 gap-1.5">
                              <select
                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700"
                                value={rule.operator || "equals"}
                                onChange={(e) => {
                                  const rules = [...(data.rules || [])];
                                  rules[i] = {
                                    ...rules[i],
                                    operator: e.target.value,
                                  };
                                  updateSelectedNodeData({ rules });
                                }}
                              >
                                <option value="equals">equals</option>
                                <option value="not_equals">
                                  does not equal
                                </option>
                                <option value="contains">contains</option>
                                <option value="not_contains">
                                  does not contain
                                </option>
                                <option value="starts_with">starts with</option>
                                <option value="ends_with">ends with</option>
                                <option value="is_empty">is empty</option>
                                <option value="is_not_empty">
                                  is not empty
                                </option>
                                <option value="greater_than">
                                  greater than
                                </option>
                                <option value="less_than">less than</option>
                              </select>
                              {rule.operator !== "is_empty" &&
                                rule.operator !== "is_not_empty" && (
                                  <Input
                                    value={rule.value || ""}
                                    onChange={(e) => {
                                      const rules = [...(data.rules || [])];
                                      rules[i] = {
                                        ...rules[i],
                                        value: e.target.value,
                                      };
                                      updateSelectedNodeData({ rules });
                                    }}
                                    placeholder="Value"
                                    className="text-[11px]"
                                  />
                                )}
                            </div>
                            <div className="flex justify-end">
                              <button
                                onClick={() => {
                                  const rules = [...(data.rules || [])];
                                  rules.splice(i, 1);
                                  updateSelectedNodeData({ rules });
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateSelectedNodeData({
                              rules: [
                                ...(data.rules || []),
                                {
                                  attribute: "message",
                                  operator: "contains",
                                  value: "",
                                },
                              ],
                            })
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-600"
                        >
                          <Plus size={12} /> Add Rule
                        </button>
                      </div>
                    </div>

                    {/* Named branches */}
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Branches (optional)
                      </label>
                      <p className="mb-2 text-[10px] text-slate-400">
                        Add named branches for multi-path routing. Otherwise
                        "Yes / Else" is used.
                      </p>
                      <div className="space-y-2">
                        {(data?.outputs || []).map((out, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-amber-100 text-[10px] font-bold text-amber-600">
                              {i + 1}
                            </div>
                            <Input
                              value={out}
                              onChange={(e) => {
                                const outputs = [...(data.outputs || [])];
                                outputs[i] = e.target.value;
                                updateSelectedNodeData({ outputs });
                              }}
                              placeholder={`Branch ${i + 1}`}
                              className="flex-1 text-[12px]"
                            />
                            <button
                              onClick={() => {
                                const outputs = [...(data.outputs || [])];
                                outputs.splice(i, 1);
                                updateSelectedNodeData({ outputs });
                              }}
                              className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateSelectedNodeData({
                              outputs: [...(data.outputs || []), ""],
                            })
                          }
                          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                        >
                          <Plus size={12} /> Add Branch
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {type === "http" && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      URL
                    </label>
                    <Input
                      value={data?.url || ""}
                      onChange={(e) =>
                        updateSelectedNodeData({ url: e.target.value })
                      }
                      placeholder="https://api.example.com/"
                      className="text-[12px]"
                    />
                  </div>
                )}
                {type === "code" && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Code
                    </label>
                    <Textarea
                      rows={6}
                      value={data?.code || data?.text || ""}
                      onChange={(e) =>
                        updateSelectedNodeData({ text: e.target.value })
                      }
                      placeholder="// Your code"
                      className="font-mono text-[11px]"
                    />
                  </div>
                )}
                {type === "input_form" && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Fields
                    </label>
                    <div className="space-y-2">
                      {(data?.fields || []).map((field, i) => (
                        <div
                          key={i}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                        >
                          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5">
                            <span className="text-[10px] font-semibold text-slate-500">
                              FIELD {i + 1}
                            </span>
                            <button
                              onClick={() => {
                                const fields = [...(data.fields || [])];
                                fields.splice(i, 1);
                                updateSelectedNodeData({ fields });
                              }}
                              className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <div className="space-y-2 p-2.5">
                            <Input
                              value={field.label || ""}
                              onChange={(e) => {
                                const fields = [...(data.fields || [])];
                                fields[i] = {
                                  ...fields[i],
                                  label: e.target.value,
                                  name: e.target.value
                                    .toLowerCase()
                                    .replace(/\s+/g, "_"),
                                };
                                updateSelectedNodeData({ fields });
                              }}
                              placeholder="Label"
                              className="text-[12px]"
                            />
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                              value={field.type || "text"}
                              onChange={(e) => {
                                const fields = [...(data.fields || [])];
                                fields[i] = {
                                  ...fields[i],
                                  type: e.target.value,
                                };
                                updateSelectedNodeData({ fields });
                              }}
                            >
                              <option value="text">Text</option>
                              <option value="email">Email</option>
                              <option value="tel">Phone</option>
                              <option value="number">Number</option>
                              <option value="url">URL</option>
                            </select>
                            <Input
                              value={field.placeholder || ""}
                              onChange={(e) => {
                                const fields = [...(data.fields || [])];
                                fields[i] = {
                                  ...fields[i],
                                  placeholder: e.target.value,
                                };
                                updateSelectedNodeData({ fields });
                              }}
                              placeholder="Placeholder"
                              className="text-[12px]"
                            />
                            <label className="flex items-center gap-2 text-[11px] text-slate-600">
                              <input
                                type="checkbox"
                                checked={field.required ?? false}
                                onChange={(e) => {
                                  const fields = [...(data.fields || [])];
                                  fields[i] = {
                                    ...fields[i],
                                    required: e.target.checked,
                                  };
                                  updateSelectedNodeData({ fields });
                                }}
                                className="rounded border-slate-300"
                              />
                              Required
                            </label>
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            fields: [
                              ...(data.fields || []),
                              {
                                name: "",
                                label: "",
                                placeholder: "",
                                type: "text",
                                required: false,
                              },
                            ],
                          })
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Plus size={12} /> Add Field
                      </button>
                    </div>
                  </div>
                )}
                {type === "input_form" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Submit Button Label
                      </label>
                      <Input
                        value={data?.submitLabel || "Submit"}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            submitLabel: e.target.value,
                          })
                        }
                        placeholder="Submit"
                        className="text-[12px]"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-[11px] font-medium text-slate-700">
                          Disable text composer
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Force user to use this form only
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            disableComposer: !data?.disableComposer,
                          })
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data?.disableComposer ? "bg-blue-500" : "bg-slate-300"}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${data?.disableComposer ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                        />
                      </button>
                    </div>
                  </>
                )}
                {type === "quick_input" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Save to Variable
                      </label>
                      {(() => {
                        const knownKeys = (attributeDefs || []).map(
                          (d) => d.key,
                        );
                        const curVar = data?.variableName || "";
                        const isCustom =
                          data?._isCustomVar ||
                          (curVar !== "" && !knownKeys.includes(curVar));
                        const selectValue = isCustom ? "__custom__" : curVar;
                        return (
                          <>
                            <select
                              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                              value={selectValue}
                              onChange={(e) => {
                                if (e.target.value === "__custom__") {
                                  updateSelectedNodeData({
                                    _isCustomVar: true,
                                    variableName: "",
                                  });
                                } else {
                                  updateSelectedNodeData({
                                    _isCustomVar: false,
                                    variableName: e.target.value,
                                  });
                                }
                              }}
                            >
                              <option value="">— Select variable —</option>
                              {(attributeDefs || []).map((d) => (
                                <option key={d.key} value={d.key}>
                                  {d.displayName} ({d.key})
                                </option>
                              ))}
                              <option value="__custom__">
                                ✎ Custom variable…
                              </option>
                            </select>
                            {isCustom && (
                              <Input
                                value={curVar}
                                onChange={(e) => {
                                  const v = e.target.value.replace(
                                    /[^a-zA-Z0-9_]/g,
                                    "",
                                  );
                                  updateSelectedNodeData({
                                    variableName: v,
                                  });
                                }}
                                placeholder="custom_var_name"
                                className="mt-1.5 text-[12px] font-mono"
                                autoFocus
                              />
                            )}
                          </>
                        );
                      })()}
                      <p className="mt-1 text-[10px] text-slate-400">
                        Store the response in this flow variable. Use{" "}
                        {"{{variableName}}"} in later nodes.
                      </p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Input Type
                      </label>
                      <select
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                        value={data?.inputType || "text"}
                        onChange={(e) =>
                          updateSelectedNodeData({ inputType: e.target.value })
                        }
                      >
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="tel">Phone</option>
                        <option value="number">Number</option>
                        <option value="url">URL</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Placeholder
                      </label>
                      <Input
                        value={data?.placeholder || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            placeholder: e.target.value,
                          })
                        }
                        placeholder="e.g. martha.collins@gmail.com"
                        className="text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Button Label
                      </label>
                      <Input
                        value={data?.buttonLabel || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            buttonLabel: e.target.value,
                          })
                        }
                        placeholder="Send"
                        className="text-[12px]"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-[11px] font-medium text-slate-700">
                          Disable text composer
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Force user to use this input only
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            disableComposer: !data?.disableComposer,
                          })
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data?.disableComposer ? "bg-blue-500" : "bg-slate-300"}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${data?.disableComposer ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                        />
                      </button>
                    </div>
                  </>
                )}
                {type === "select" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Placeholder
                      </label>
                      <Input
                        value={data?.placeholder || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            placeholder: e.target.value,
                          })
                        }
                        placeholder="Select one"
                        className="text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Button Label
                      </label>
                      <Input
                        value={data?.buttonLabel || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            buttonLabel: e.target.value,
                          })
                        }
                        placeholder="Send"
                        className="text-[12px]"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

          {/* ── Start / Trigger Settings ── */}
          {(type === "start" || type === "trigger") && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Node label"
                  className="text-[12px]"
                />
              </div>
              {type === "trigger" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Run When
                    </label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                      value={data?.on || "widget_open"}
                      onChange={(e) =>
                        updateSelectedNodeData({ on: e.target.value })
                      }
                    >
                      <option value="widget_open">Widget opens</option>
                      <option value="page_open">Page opens</option>
                      <option value="first_message">
                        First visitor message
                      </option>
                      <option value="any_message">Any visitor message</option>
                      <option value="conversation_closed">
                        Conversation closed
                      </option>
                      <option value="conversation_reopened">
                        Conversation reopened
                      </option>
                    </select>
                  </div>
                  {!["conversation_closed", "conversation_reopened"].includes(data?.on) && (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Keywords
                    </label>
                    <div className="space-y-2">
                      {(data?.keywords || []).map((kw, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-blue-100 text-[10px] font-bold text-blue-600">
                            {i + 1}
                          </div>
                          <Input
                            value={kw}
                            onChange={(e) => {
                              const keywords = [...(data.keywords || [])];
                              keywords[i] = e.target.value;
                              updateSelectedNodeData({ keywords });
                            }}
                            placeholder={`Keyword ${i + 1}`}
                            className="flex-1 text-[12px]"
                          />
                          <button
                            onClick={() => {
                              const keywords = [...(data.keywords || [])];
                              keywords.splice(i, 1);
                              updateSelectedNodeData({ keywords });
                            }}
                            className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          updateSelectedNodeData({
                            keywords: [...(data.keywords || []), ""],
                          })
                        }
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                      >
                        <Plus size={12} /> Add Keyword
                      </button>
                    </div>
                  </div>
                  )}
                </>
              )}
              {/* ── Flow Input Variables ── */}
              <div className="border-t border-slate-100 pt-3">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Input Variables
                </label>
                <p className="mb-2 text-[10px] text-slate-400">
                  Define variables other flows must provide when calling this
                  flow.
                </p>
                <div className="space-y-2">
                  {(flowInputVariables || []).map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={v.key}
                        onChange={(e) => {
                          const next = [...flowInputVariables];
                          next[i] = { ...next[i], key: e.target.value };
                          setFlowInputVariables(next);
                        }}
                        placeholder="key"
                        className="flex-1 text-[12px] font-mono"
                      />
                      <Input
                        value={v.label}
                        onChange={(e) => {
                          const next = [...flowInputVariables];
                          next[i] = { ...next[i], label: e.target.value };
                          setFlowInputVariables(next);
                        }}
                        placeholder="Label"
                        className="flex-1 text-[12px]"
                      />
                      <label className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={v.required ?? false}
                          onChange={(e) => {
                            const next = [...flowInputVariables];
                            next[i] = {
                              ...next[i],
                              required: e.target.checked,
                            };
                            setFlowInputVariables(next);
                          }}
                          className="rounded"
                        />
                        Req
                      </label>
                      <button
                        onClick={() => {
                          const next = [...flowInputVariables];
                          next.splice(i, 1);
                          setFlowInputVariables(next);
                        }}
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setFlowInputVariables([
                        ...(flowInputVariables || []),
                        { key: "", label: "", required: false },
                      ])
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-teal-400 hover:bg-teal-50 hover:text-teal-600"
                  >
                    <Plus size={12} /> Add Input Variable
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Start Flow Node Settings ── */}
          {type === "start_flow" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Target Flow
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                  value={data?.flowId || ""}
                  onChange={(e) => {
                    const newFlowId = e.target.value;
                    updateSelectedNodeData({
                      flowId: newFlowId,
                      variableBindings: {},
                    });
                  }}
                >
                  <option value="">— Select a flow —</option>
                  {(flows || [])
                    .filter((f) => f.id !== activeFlowId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </div>

              {(() => {
                const targetFlow = (flows || []).find(
                  (f) => f.id === data?.flowId,
                );
                const targetVars = targetFlow?.inputVariables || [];
                if (!targetFlow || targetVars.length === 0) return null;
                const bindings = data?.variableBindings || {};
                return (
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Variable Bindings
                    </label>
                    <p className="mb-2 text-[10px] text-slate-400">
                      Map values to the target flow's input variables. Use{" "}
                      {"{{varName}}"} for interpolation.
                    </p>
                    <div className="space-y-2">
                      {targetVars.map((v) => (
                        <div key={v.key} className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-teal-50 px-2 py-1 text-[11px] font-mono text-teal-700 border border-teal-200">
                            {v.label || v.key}
                            {v.required && (
                              <span className="ml-0.5 text-red-400">*</span>
                            )}
                          </span>
                          <Input
                            value={bindings[v.key] || ""}
                            onChange={(e) => {
                              updateSelectedNodeData({
                                variableBindings: {
                                  ...bindings,
                                  [v.key]: e.target.value,
                                },
                              });
                            }}
                            placeholder={`Value or {{variable}}`}
                            className="flex-1 text-[12px] font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* AI collect missing inputs */}
              {(() => {
                const targetFlow = (flows || []).find(
                  (f) => f.id === data?.flowId,
                );
                const hasRequired = (targetFlow?.inputVariables || []).some(
                  (v) => v.required,
                );
                if (!targetFlow || !hasRequired) return null;
                return (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!data?.aiCollectInputs}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            aiCollectInputs: e.target.checked,
                          })
                        }
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <div>
                        <span className="text-[12px] font-medium text-slate-700">
                          Use AI to fill required inputs
                        </span>
                        <p className="mt-0.5 text-[10px] text-slate-400 leading-relaxed">
                          When required variables are missing, the AI will
                          conversationally ask the visitor for the values before
                          starting the flow.
                        </p>
                      </div>
                    </label>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── End Node Settings ── */}
          {type === "end" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Behavior
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                  value={data?.behavior || "close"}
                  onChange={(e) =>
                    updateSelectedNodeData({ behavior: e.target.value })
                  }
                >
                  <option value="close">Close conversation</option>
                  <option value="handover">Transfer to human agent</option>
                  <option value="stop">Just stop (keep open)</option>
                </select>
              </div>
              {data?.behavior === "close" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Close Message
                  </label>
                  <Input
                    value={data?.closeMessage || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ closeMessage: e.target.value })
                    }
                    placeholder="Conversation closed"
                    className="text-[12px]"
                  />
                </div>
              )}
              {data?.behavior === "handover" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Handover Message
                  </label>
                  <Input
                    value={data?.handoverMessage || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({
                        handoverMessage: e.target.value,
                      })
                    }
                    placeholder="Transferring to a human agent..."
                    className="text-[12px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Wait Settings ── */}
          {type === "wait" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Wait"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Duration
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={1}
                    value={data?.duration ?? 60}
                    onChange={(e) =>
                      updateSelectedNodeData({
                        duration: Number(e.target.value) || 60,
                      })
                    }
                    className="flex-1 text-[12px]"
                  />
                  <select
                    className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                    value={data?.unit || "seconds"}
                    onChange={(e) =>
                      updateSelectedNodeData({ unit: e.target.value })
                    }
                  >
                    <option value="seconds">Seconds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ── Assign Settings ── */}
          {type === "assign" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Assign"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Assign To
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                  value={data?.assignTo || "team"}
                  onChange={(e) =>
                    updateSelectedNodeData({ assignTo: e.target.value })
                  }
                >
                  <option value="team">Team</option>
                  <option value="agent">Specific Agent</option>
                </select>
              </div>
              {data?.assignTo === "team" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Team Name
                  </label>
                  <Input
                    value={data?.teamName || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ teamName: e.target.value })
                    }
                    placeholder="e.g. Support"
                    className="text-[12px]"
                  />
                </div>
              )}
              {data?.assignTo === "agent" && (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Agent Email
                  </label>
                  <Input
                    value={data?.agentEmail || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ agentEmail: e.target.value })
                    }
                    placeholder="agent@company.com"
                    className="text-[12px]"
                  />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Message (optional)
                </label>
                <Input
                  value={data?.message || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ message: e.target.value })
                  }
                  placeholder="You've been assigned to this conversation"
                  className="text-[12px]"
                />
              </div>
            </div>
          )}

          {/* ── Close Conversation Settings ── */}
          {type === "close_conversation" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Close Conversation"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Closing Message (optional)
                </label>
                <Textarea
                  rows={2}
                  value={data?.message || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ message: e.target.value })
                  }
                  placeholder="Thanks for contacting us!"
                  className="text-[12px]"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={data?.sendCsat ?? false}
                  onChange={(e) =>
                    updateSelectedNodeData({ sendCsat: e.target.checked })
                  }
                  className="rounded border-slate-300"
                />
                Send CSAT survey before closing
              </label>
            </div>
          )}

          {/* ── CSAT Settings ── */}
          {type === "csat" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="CSAT Rating"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Question Text
                </label>
                <div className="relative">
                  <Textarea
                    rows={2}
                    value={data?.text || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ text: e.target.value })
                    }
                    placeholder="How would you rate your experience?"
                    className="pr-8 text-[12px]"
                  />
                  <VariablePickerDropdown
                    attributeDefs={attributeDefs}
                    flowInputVariables={flowInputVariables}
                    onSelect={(varKey) => {
                      const cur = data?.text || "";
                      updateSelectedNodeData({ text: cur + `{{${varKey}}}` });
                    }}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Rating Type
                </label>
                <select
                  value={data?.ratingType || "emoji"}
                  onChange={(e) =>
                    updateSelectedNodeData({ ratingType: e.target.value })
                  }
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700"
                >
                  <option value="emoji">😡 Emoji</option>
                  <option value="stars">⭐ Stars</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Tag Settings ── */}
          {type === "tag" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Tag"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Action
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                  value={data?.action || "add"}
                  onChange={(e) =>
                    updateSelectedNodeData({ action: e.target.value })
                  }
                >
                  <option value="add">Add tags</option>
                  <option value="remove">Remove tags</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Tags
                </label>
                <div className="space-y-2">
                  {(data?.tags || []).map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-purple-100 text-[10px] font-bold text-purple-600">
                        {i + 1}
                      </div>
                      <Input
                        value={t}
                        onChange={(e) => {
                          const tags = [...(data.tags || [])];
                          tags[i] = e.target.value;
                          updateSelectedNodeData({ tags });
                        }}
                        placeholder={`Tag ${i + 1}`}
                        className="flex-1 text-[12px]"
                      />
                      <button
                        onClick={() => {
                          const tags = [...(data.tags || [])];
                          tags.splice(i, 1);
                          updateSelectedNodeData({ tags });
                        }}
                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      updateSelectedNodeData({
                        tags: [...(data.tags || []), ""],
                      })
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <Plus size={12} /> Add Tag
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Set Attribute Settings ── */}
          {type === "set_attribute" &&
            (() => {
              const targetModel = data?.target || "contact";
              const filteredDefs = (attributeDefs || []).filter(
                (d) => d.attributeModel === targetModel,
              );
              const builtInAttrs =
                targetModel === "contact"
                  ? [
                      { key: "email", displayName: "Email" },
                      { key: "name", displayName: "Name" },
                      { key: "phone", displayName: "Phone" },
                      { key: "company", displayName: "Company" },
                      { key: "location", displayName: "Location" },
                    ]
                  : [];
              return (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Label
                    </label>
                    <Input
                      value={data?.label || ""}
                      onChange={(e) =>
                        updateSelectedNodeData({ label: e.target.value })
                      }
                      placeholder="Set Attribute"
                      className="text-[12px]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Target
                    </label>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                      value={targetModel}
                      onChange={(e) =>
                        updateSelectedNodeData({
                          target: e.target.value,
                          attributeName: "",
                        })
                      }
                    >
                      <option value="contact">Contact</option>
                      <option value="conversation">Conversation</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Attribute
                    </label>
                    {(() => {
                      const knownAttrKeys = [
                        ...builtInAttrs.map((a) => a.key),
                        ...filteredDefs.map((d) => d.key),
                      ];
                      const curAttr = data?.attributeName || "";
                      const isCustomAttr =
                        data?._isCustomAttr ||
                        (curAttr !== "" && !knownAttrKeys.includes(curAttr));
                      const selectAttrValue = isCustomAttr
                        ? "__custom__"
                        : curAttr;
                      return (
                        <>
                          <select
                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                            value={selectAttrValue}
                            onChange={(e) => {
                              if (e.target.value === "__custom__") {
                                updateSelectedNodeData({
                                  _isCustomAttr: true,
                                  attributeName: "",
                                });
                              } else {
                                updateSelectedNodeData({
                                  _isCustomAttr: false,
                                  attributeName: e.target.value,
                                });
                              }
                            }}
                          >
                            <option value="">— Select attribute —</option>
                            {builtInAttrs.length > 0 && (
                              <optgroup label="Built-in">
                                {builtInAttrs.map((a) => (
                                  <option key={a.key} value={a.key}>
                                    {a.displayName}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {filteredDefs.length > 0 && (
                              <optgroup label="Custom Attributes">
                                {filteredDefs.map((d) => (
                                  <option key={d.key} value={d.key}>
                                    {d.displayName}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="__custom__">✎ Custom key…</option>
                          </select>
                          {isCustomAttr && (
                            <Input
                              value={curAttr}
                              onChange={(e) => {
                                const v = e.target.value.replace(
                                  /[^a-zA-Z0-9_]/g,
                                  "",
                                );
                                updateSelectedNodeData({
                                  attributeName: v,
                                });
                              }}
                              placeholder="custom_key"
                              className="mt-1.5 text-[12px] font-mono"
                              autoFocus
                            />
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Value
                    </label>
                    <div className="relative">
                      <Input
                        value={data?.attributeValue || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({
                            attributeValue: e.target.value,
                          })
                        }
                        placeholder="e.g. {{user_email}}"
                        className="pr-8 text-[12px]"
                      />
                      <VariablePickerDropdown
                        attributeDefs={attributeDefs}
                        flowInputVariables={flowInputVariables}
                        onSelect={(varKey) => {
                          const cur = data?.attributeValue || "";
                          updateSelectedNodeData({
                            attributeValue: cur + `{{${varKey}}}`,
                          });
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      Use {"{{variableName}}"} to insert flow variable values.
                    </p>
                  </div>
                </div>
              );
            })()}

          {/* ── Note Settings ── */}
          {type === "note" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Note"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Internal Note
                </label>
                <div className="relative">
                  <Textarea
                    rows={4}
                    value={data?.text || ""}
                    onChange={(e) =>
                      updateSelectedNodeData({ text: e.target.value })
                    }
                    placeholder="Note visible only to agents..."
                    className="pr-8 text-[12px]"
                  />
                  <VariablePickerDropdown
                    attributeDefs={attributeDefs}
                    flowInputVariables={flowInputVariables}
                    onSelect={(varKey) => {
                      const cur = data?.text || "";
                      updateSelectedNodeData({ text: cur + `{{${varKey}}}` });
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Webhook Settings ── */}
          {type === "webhook" && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Label
                </label>
                <Input
                  value={data?.label || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ label: e.target.value })
                  }
                  placeholder="Webhook"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Method
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                  value={data?.method || "POST"}
                  onChange={(e) =>
                    updateSelectedNodeData({ method: e.target.value })
                  }
                >
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="GET">GET</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  URL
                </label>
                <Input
                  value={data?.url || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ url: e.target.value })
                  }
                  placeholder="https://hooks.example.com/webhook"
                  className="text-[12px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Headers (JSON)
                </label>
                <Textarea
                  rows={2}
                  value={data?.headers || "{}"}
                  onChange={(e) =>
                    updateSelectedNodeData({ headers: e.target.value })
                  }
                  placeholder='{"Content-Type": "application/json"}'
                  className="font-mono text-[11px]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Body (JSON)
                </label>
                <Textarea
                  rows={4}
                  value={data?.body || "{}"}
                  onChange={(e) =>
                    updateSelectedNodeData({ body: e.target.value })
                  }
                  placeholder='{"event": "conversation.closed"}'
                  className="font-mono text-[11px]"
                />
              </div>
            </div>
          )}

          {/* ── Delay (all message-sending nodes) ── */}
          {(type === "message" ||
            type === "buttons" ||
            type === "carousel" ||
            type === "select" ||
            type === "input_form" ||
            type === "quick_input" ||
            type === "csat") && (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Typing Delay (ms)
              </label>
              <Input
                type="number"
                min={0}
                max={6000}
                step={100}
                value={data?.delayMs ?? 420}
                onChange={(e) =>
                  updateSelectedNodeData({
                    delayMs: Number(e.target.value) || 420,
                  })
                }
                className="text-[12px]"
              />
            </div>
          )}

          <Separator />

          <Button
            size="sm"
            variant="destructive"
            onClick={removeSelectedNode}
            className="w-full text-[11px]"
          >
            <Trash2 size={12} className="mr-1.5" /> Remove Node
          </Button>

          {/* ── Custom Attribute Definitions ── */}
          <Separator className="my-4" />
          <div>
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500"
            >
              <span className="flex items-center gap-1.5">
                <Hash size={12} />
                Custom Attributes
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                  {(attributeDefs || []).length}
                </span>
              </span>
              {advancedOpen ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-2">
                {(attributeDefs || []).map((def) => (
                  <div
                    key={def.id}
                    className="group rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-slate-700">
                          {def.displayName}
                        </p>
                        <p className="font-mono text-[10px] text-violet-500">
                          {def.key}
                        </p>
                        {def.description && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {def.description}
                          </p>
                        )}
                        <span
                          className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                            def.attributeModel === "contact"
                              ? "bg-blue-50 text-blue-600"
                              : "bg-amber-50 text-amber-600"
                          }`}
                        >
                          {def.attributeModel}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await apiFetch(
                              `/api/attribute-definitions/${def.id}`,
                              token,
                              { method: "DELETE" },
                            );
                            setAttributeDefs((prev) =>
                              prev.filter((d) => d.id !== def.id),
                            );
                          } catch {}
                        }}
                        className="rounded p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}

                {showNewAttrForm ? (
                  <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/30 p-2.5">
                    <Input
                      value={newAttrDisplayName}
                      onChange={(e) => {
                        setNewAttrDisplayName(e.target.value);
                        setNewAttrKey(
                          e.target.value
                            .trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "_")
                            .replace(/^_|_$/g, ""),
                        );
                      }}
                      placeholder="Display name"
                      className="text-[12px]"
                      autoFocus
                    />
                    <Input
                      value={newAttrKey}
                      onChange={(e) =>
                        setNewAttrKey(
                          e.target.value.replace(/[^a-zA-Z0-9_]/g, ""),
                        )
                      }
                      placeholder="variable_key"
                      className="font-mono text-[12px]"
                    />
                    <Input
                      value={newAttrDesc}
                      onChange={(e) => setNewAttrDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="text-[12px]"
                    />
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]"
                      value={newAttrModel}
                      onChange={(e) => setNewAttrModel(e.target.value)}
                    >
                      <option value="contact">Contact</option>
                      <option value="conversation">Conversation</option>
                    </select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 flex-1 bg-blue-500 text-[11px] text-white hover:bg-blue-600"
                        disabled={
                          !newAttrDisplayName.trim() || !newAttrKey.trim()
                        }
                        onClick={async () => {
                          try {
                            const res = await apiFetch(
                              "/api/attribute-definitions",
                              token,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  displayName: newAttrDisplayName.trim(),
                                  key: newAttrKey.trim(),
                                  description: newAttrDesc.trim(),
                                  attributeModel: newAttrModel,
                                }),
                              },
                            );
                            setAttributeDefs((prev) => [
                              ...prev,
                              res.attributeDefinition,
                            ]);
                            setNewAttrDisplayName("");
                            setNewAttrKey("");
                            setNewAttrDesc("");
                            setNewAttrModel("contact");
                            setShowNewAttrForm(false);
                          } catch {}
                        }}
                      >
                        Create
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        onClick={() => {
                          setShowNewAttrForm(false);
                          setNewAttrDisplayName("");
                          setNewAttrKey("");
                          setNewAttrDesc("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewAttrForm(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                  >
                    <Plus size={12} /> New Attribute
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

/* ─── Top Toolbar ─────────────────────────────────────────── */

function FlowTopBar({
  flowSaveStatus,
  saveFlow,
  activeFlowId,
  flowName,
  setFlowName,
  flowDescription,
  setFlowDescription,
  flowEnabled,
  setFlowEnabled,
  deleteCurrentFlow,
  flowAiTool,
  setFlowAiTool,
  flowAiToolDescription,
  setFlowAiToolDescription,
}) {
  const [showMeta, setShowMeta] = useState(false);
  const timeStr = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={() => setShowMeta(!showMeta)}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-slate-50 transition-colors min-w-0"
        >
          <span className="truncate text-[13px] font-semibold text-slate-800 max-w-[180px]">
            {flowName || "Untitled flow"}
          </span>
          <ChevronDown size={12} className="shrink-0 text-slate-400" />
        </button>
        <span className="text-[10px] text-slate-400 shrink-0">
          {flowSaveStatus || "Unpublished"}
        </span>
        {showMeta && (
          <div className="absolute left-4 top-12 z-50 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg space-y-2.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Name
              </label>
              <Input
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                placeholder="Flow name"
                className="text-[12px]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Description
              </label>
              <Input
                value={flowDescription}
                onChange={(e) => setFlowDescription(e.target.value)}
                placeholder="Optional description"
                className="text-[12px]"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600">Enabled</span>
              <button
                onClick={() => setFlowEnabled(!flowEnabled)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${flowEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${flowEnabled ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600">AI agent tool</span>
              <button
                onClick={() => setFlowAiTool(!flowAiTool)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${flowAiTool ? "bg-violet-500" : "bg-slate-300"}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${flowAiTool ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                />
              </button>
            </div>
            {flowAiTool && (
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Tool description (for AI)
                </label>
                <Input
                  value={flowAiToolDescription}
                  onChange={(e) => setFlowAiToolDescription(e.target.value)}
                  placeholder="e.g. Collect billing info and process refund"
                  className="text-[12px]"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Describe what this flow does so the AI knows when to trigger
                  it.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <button
                onClick={() => {
                  deleteCurrentFlow();
                  setShowMeta(false);
                }}
                className="text-[11px] font-medium text-red-500 hover:text-red-600"
              >
                Delete flow
              </button>
              <button
                onClick={() => setShowMeta(false)}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={saveFlow}
          disabled={!activeFlowId}
          className="gap-1.5 rounded-lg bg-blue-500 text-[12px] text-white hover:bg-blue-600"
        >
          Publish <ChevronDown size={12} />
        </Button>
      </div>
    </div>
  );
}

/* ─── Add Node Palette ────────────────────────────────────── */

function AddNodePalette({ addFlowNode }) {
  const [open, setOpen] = useState(false);
  const { screenToFlowPosition } = useReactFlow();

  const addAtCenter = (type) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const pos = screenToFlowPosition({ x: centerX, y: centerY });
    addFlowNode(type, pos.x - 110, pos.y - 30);
  };

  const types = [
    { type: "start", label: "Start", icon: Zap },
    { type: "llm", label: "LLM", icon: Brain },
    { type: "ai", label: "Question Classifier", icon: Sparkles },
    { type: "condition", label: "If / Else", icon: RefreshCw },
    { type: "message", label: "Message", icon: MessageSquare },
    { type: "buttons", label: "Buttons", icon: Puzzle },
    { type: "input_form", label: "Input Form", icon: FileText },
    { type: "quick_input", label: "Quick Input", icon: Pencil },
    { type: "csat", label: "CSAT Rating", icon: Star },
    { type: "wait", label: "Wait / Snooze", icon: Clock },
    { type: "assign", label: "Assign", icon: UserPlus },
    { type: "close_conversation", label: "Close Conversation", icon: XCircle },
    { type: "tag", label: "Tag", icon: Tag },
    { type: "set_attribute", label: "Set Attribute", icon: Hash },
    { type: "note", label: "Note", icon: StickyNote },
    { type: "webhook", label: "Webhook", icon: Send },
    { type: "start_flow", label: "Start Flow", icon: Workflow },
    { type: "http", label: "HTTP Request", icon: Globe },
    { type: "code", label: "Code", icon: Code2 },
    { type: "end", label: "End", icon: CircleDot },
  ];

  return (
    <div className="absolute right-3 bottom-3 z-10">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-colors"
        >
          <Plus size={18} />
        </button>
      ) : (
        <div className="w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[11px] font-semibold text-slate-500">
              Add Node
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          </div>
          <div className="space-y-0.5">
            {types.map(({ type, label, icon: Icon }) => {
              const c = NODE_COLORS[type] || NODE_COLORS.message;
              return (
                <button
                  key={type}
                  onClick={() => {
                    addAtCenter(type);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded"
                    style={{ backgroundColor: c.iconBg }}
                  >
                    <Icon size={12} style={{ color: c.icon }} />
                  </div>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main FlowsView ─────────────────────────────────────── */

export default function FlowsView({
  flows,
  createFlow,
  activeFlowId,
  setActiveFlowId,
  loadFlowIntoEditor,
  flowName,
  setFlowName,
  flowEnabled,
  setFlowEnabled,
  saveFlow,
  deleteCurrentFlow,
  flowSaveStatus,
  flowNodes,
  flowEdges,
  onFlowNodesChange,
  onFlowEdgesChange,
  onFlowConnect,
  setSelectedNodeId,
  addFlowNode,
  flowDescription,
  setFlowDescription,
  selectedNode,
  updateSelectedNodeData,
  carouselItemsText,
  removeSelectedNode,
  attributeDefs,
  setAttributeDefs,
  apiFetch,
  token,
  flowInputVariables,
  setFlowInputVariables,
  flowAiTool,
  setFlowAiTool,
  flowAiToolDescription,
  setFlowAiToolDescription,
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr_340px] bg-[#f0f2f7] max-[1200px]:grid-cols-[1fr]">
      {/* ── Left: Flow list ── */}
      <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-200 bg-white max-[1200px]:hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
          <h3 className="text-[13px] font-semibold text-slate-700">Flows</h3>
          <Button
            size="sm"
            onClick={createFlow}
            className="h-7 rounded-lg bg-blue-500 px-2.5 text-[11px] text-white hover:bg-blue-600"
          >
            <Plus size={12} className="mr-1" /> New
          </Button>
        </div>
        <ScrollArea className="h-full">
          <div className="space-y-1 p-2">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => {
                  setActiveFlowId(flow.id);
                  loadFlowIntoEditor(flow);
                }}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  flow.id === activeFlowId
                    ? "border-blue-200 bg-blue-50"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                    <Zap size={13} className="text-blue-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-slate-800">
                      {flow.name}
                    </p>
                    <p className="truncate text-[10px] text-slate-400">
                      {flow.aiTool ? "🔧 AI tool · " : ""}
                      {flow.description || "No description"}
                    </p>
                  </div>
                  <span
                    className={`h-2 w-2 rounded-full ${flow.enabled ? "bg-emerald-400" : "bg-slate-300"}`}
                  />
                </div>
              </button>
            ))}
            {flows.length === 0 && (
              <div className="flex flex-col items-center py-8 text-center">
                <Zap size={24} className="mb-2 text-slate-300" />
                <p className="text-[11px] text-slate-400">No flows yet</p>
                <p className="text-[10px] text-slate-300">
                  Create your first flow
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ── Center: Canvas ── */}
      <section className="grid min-h-0 grid-rows-[auto_1fr]">
        <FlowTopBar
          flowSaveStatus={flowSaveStatus}
          saveFlow={saveFlow}
          activeFlowId={activeFlowId}
          flowName={flowName}
          setFlowName={setFlowName}
          flowDescription={flowDescription}
          setFlowDescription={setFlowDescription}
          flowEnabled={flowEnabled}
          setFlowEnabled={setFlowEnabled}
          deleteCurrentFlow={deleteCurrentFlow}
          flowAiTool={flowAiTool}
          setFlowAiTool={setFlowAiTool}
          flowAiToolDescription={flowAiToolDescription}
          setFlowAiToolDescription={setFlowAiToolDescription}
        />
        <div
          className="relative min-h-0"
          style={{
            background: "linear-gradient(135deg, #f5f7fb 0%, #eef1f8 100%)",
          }}
        >
          <ReactFlowProvider>
            <AddNodePalette addFlowNode={addFlowNode} />
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={FLOW_NODE_TYPES}
              onNodesChange={onFlowNodesChange}
              onEdgesChange={onFlowEdgesChange}
              onConnect={onFlowConnect}
              onSelectionChange={({ nodes }) =>
                setSelectedNodeId(nodes?.[0]?.id || "")
              }
              fitView
              connectionLineType={ConnectionLineType.SmoothStep}
              defaultEdgeOptions={{
                animated: false,
                type: "smoothstep",
                style: { stroke: "#94a3b8", strokeWidth: 1.5 },
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Controls className="!rounded-xl !border-slate-200 !shadow-sm" />
              <Background gap={20} size={1} color="#dce0ea" variant="dots" />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </section>

      {/* ── Right: Settings Panel ── */}
      <aside className="min-h-0 border-l border-slate-200 bg-white max-[1200px]:hidden">
        <SettingsPanel
          selectedNode={selectedNode}
          updateSelectedNodeData={updateSelectedNodeData}
          removeSelectedNode={removeSelectedNode}
          attributeDefs={attributeDefs}
          setAttributeDefs={setAttributeDefs}
          apiFetch={apiFetch}
          token={token}
          flows={flows}
          activeFlowId={activeFlowId}
          flowInputVariables={flowInputVariables}
          setFlowInputVariables={setFlowInputVariables}
        />
      </aside>
    </div>
  );
}

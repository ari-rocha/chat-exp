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
} from "@xyflow/react";
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Copy,
  Eye,
  FileText,
  Globe,
  GripVertical,
  Image,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
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
  return type.replace(/_/g, " ").toUpperCase();
}

function outputPorts(type, data) {
  if (type === "condition") {
    const custom = Array.isArray(data?.outputs)
      ? data.outputs.filter(Boolean)
      : [];
    if (custom.length > 0)
      return custom.map((label, index) => ({ id: `out-${index}`, label }));
    return [
      { id: "true", label: "Yes" },
      { id: "false", label: "No" },
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
              {data?.text && <p className="text-slate-500 mb-1">{data.text}</p>}
              {(data?.buttons || []).map((btn, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-500 whitespace-nowrap text-[10px]">
                    BTN {i + 1}
                  </span>
                  <span className="text-slate-600 truncate">{btn}</span>
                </div>
              ))}
            </div>
          )}

          {/* SELECT body */}
          {type === "select" && (
            <div className="space-y-1">
              {data?.text && <p className="text-slate-500 mb-1">{data.text}</p>}
              {(data?.options || []).map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-500 whitespace-nowrap text-[10px]">
                    OPT {i + 1}
                  </span>
                  <span className="text-slate-600 truncate">{opt}</span>
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

          {/* Generic fallback body */}
          {!isStart &&
            type !== "llm" &&
            !isClassifier &&
            type !== "http" &&
            type !== "code" &&
            type !== "end" &&
            type !== "buttons" &&
            type !== "select" &&
            type !== "input_form" && (
              <p className="text-slate-600 line-clamp-2">
                {data?.text || data?.label || ""}
              </p>
            )}
        </div>
      )}

      {/* ── Source handles ── */}
      {outputs.length > 0 ? (
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
      )}
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
};

/* ─── Right Sidebar — Settings Panel ─────────────────────── */

function SettingsPanel({
  selectedNode,
  updateSelectedNodeData,
  removeSelectedNode,
}) {
  const [activeTab, setActiveTab] = useState("settings");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(true);
  const [resolution, setResolution] = useState("High");

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
                      <Textarea
                        rows={3}
                        className="min-h-[60px] border-0 bg-transparent p-0 text-[11px] text-slate-600 shadow-none focus-visible:ring-0 resize-none"
                        value={
                          data?.prompt ||
                          "You are an entity extraction model that accepts an input text and ⊙ Start {x} type of entities to extract."
                        }
                        onChange={(e) =>
                          updateSelectedNodeData({ prompt: e.target.value })
                        }
                      />
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
                <Textarea
                  rows={4}
                  value={data?.prompt || data?.text || ""}
                  onChange={(e) =>
                    updateSelectedNodeData({ text: e.target.value })
                  }
                  placeholder="System prompt for the LLM"
                  className="text-[12px]"
                />
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
                    <Textarea
                      rows={3}
                      value={data?.text || ""}
                      onChange={(e) =>
                        updateSelectedNodeData({ text: e.target.value })
                      }
                      placeholder="Message text"
                      className="text-[12px]"
                    />
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
                    <div>
                      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Contains
                      </label>
                      <Input
                        value={data?.contains || ""}
                        onChange={(e) =>
                          updateSelectedNodeData({ contains: e.target.value })
                        }
                        placeholder="Contains text"
                        className="text-[12px]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Outputs
                      </label>
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
                              placeholder={`Output ${i + 1}`}
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
                          <Plus size={12} /> Add Output
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
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Submit Button Label
                    </label>
                    <Input
                      value={data?.submitLabel || "Submit"}
                      onChange={(e) =>
                        updateSelectedNodeData({ submitLabel: e.target.value })
                      }
                      placeholder="Submit"
                      className="text-[12px]"
                    />
                  </div>
                )}
                {type === "quick_input" && (
                  <>
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
                    </select>
                  </div>
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
                </>
              )}
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

          {/* ── Delay (all message-sending nodes) ── */}
          {(type === "message" ||
            type === "buttons" ||
            type === "carousel" ||
            type === "select" ||
            type === "input_form" ||
            type === "quick_input") && (
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
        </div>
      </ScrollArea>
    </div>
  );
}

/* ─── Top Toolbar ─────────────────────────────────────────── */

function FlowTopBar({ flowSaveStatus, saveFlow, activeFlowId }) {
  const timeStr = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-200 bg-white px-4">
      <span className="text-[11px] text-slate-400">
        Auto-Saved {timeStr} · {flowSaveStatus || "Unpublished"}
      </span>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-0.5 py-0.5">
          <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <Pencil size={14} />
          </button>
          <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <Eye size={14} />
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 rounded-lg text-[12px]"
        >
          <Play size={12} /> Preview
        </Button>
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

  const types = [
    { type: "start", label: "Start", icon: Zap },
    { type: "llm", label: "LLM", icon: Brain },
    { type: "ai", label: "Question Classifier", icon: Sparkles },
    { type: "condition", label: "If / Else", icon: RefreshCw },
    { type: "message", label: "Message", icon: MessageSquare },
    { type: "buttons", label: "Buttons", icon: Puzzle },
    { type: "input_form", label: "Input Form", icon: FileText },
    { type: "quick_input", label: "Quick Input", icon: Pencil },
    { type: "http", label: "HTTP Request", icon: Globe },
    { type: "code", label: "Code", icon: Code2 },
    { type: "end", label: "End", icon: CircleDot },
  ];

  return (
    <div className="absolute left-3 top-3 z-10">
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
                    addFlowNode(type);
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
        />
        <div
          className="relative min-h-0"
          style={{
            background: "linear-gradient(135deg, #f5f7fb 0%, #eef1f8 100%)",
          }}
        >
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
        </div>
      </section>

      {/* ── Right: Settings Panel ── */}
      <aside className="min-h-0 border-l border-slate-200 bg-white max-[1200px]:hidden">
        <SettingsPanel
          selectedNode={selectedNode}
          updateSelectedNodeData={updateSelectedNodeData}
          removeSelectedNode={removeSelectedNode}
        />
      </aside>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
} from "@xyflow/react";

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
    <div className="grid min-h-0 grid-cols-[280px_1fr_320px] bg-slate-50 max-[1200px]:grid-cols-[1fr]">
      <aside className="grid min-h-0 grid-rows-[auto_1fr] border-r border-slate-200 bg-white p-3 max-[1200px]:hidden">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Flows</h3>
          <Button size="sm" onClick={createFlow}>New</Button>
        </div>

        <ScrollArea className="h-full pr-2">
          <div className="space-y-2">
            {flows.map((flow) => (
              <button
                key={flow.id}
                onClick={() => {
                  setActiveFlowId(flow.id);
                  loadFlowIntoEditor(flow);
                }}
                className={`w-full rounded-md border px-3 py-2 text-left ${
                  flow.id === activeFlowId ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
                }`}
              >
                <p className="text-sm font-medium text-slate-900">{flow.name}</p>
                <p className="text-xs text-slate-500">{flow.description || "No description"}</p>
                <p className="mt-1 text-[11px] uppercase text-slate-400">{flow.enabled ? "enabled" : "disabled"}</p>
              </button>
            ))}
            {flows.length === 0 && <p className="text-xs text-slate-400">No flows yet.</p>}
          </div>
        </ScrollArea>
      </aside>

      <section className="grid min-h-0 grid-rows-[56px_1fr]">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3">
          <Input value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="Flow name" className="max-w-sm" />
          <Badge variant={flowEnabled ? "default" : "secondary"}>{flowEnabled ? "enabled" : "disabled"}</Badge>
          <Button variant="outline" size="sm" onClick={() => setFlowEnabled((v) => !v)}>Toggle</Button>
          <Button size="sm" onClick={saveFlow} disabled={!activeFlowId}>Save Flow</Button>
          <Button size="sm" variant="destructive" onClick={deleteCurrentFlow} disabled={!activeFlowId}>Delete</Button>
          {flowSaveStatus && <span className="text-xs text-slate-500">{flowSaveStatus}</span>}
        </div>

        <div className="relative min-h-0 bg-slate-100">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onFlowNodesChange}
            onEdgesChange={onFlowEdgesChange}
            onConnect={onFlowConnect}
            onSelectionChange={({ nodes }) => setSelectedNodeId(nodes?.[0]?.id || "")}
            fitView
            connectionLineType={ConnectionLineType.SmoothStep}
          >
            <MiniMap pannable zoomable />
            <Controls />
            <Background gap={24} size={1.5} color="#d7dce5" />
          </ReactFlow>
        </div>
      </section>

      <aside className="border-l border-slate-200 bg-white p-3 max-[1200px]:hidden">
        <h3 className="text-sm font-semibold">Flow Inspector</h3>
        <p className="mb-3 text-xs text-slate-500">Add nodes, edit node data, and configure AI behavior.</p>

        <div className="grid grid-cols-2 gap-2">
          {["trigger", "condition", "message", "buttons", "carousel", "select", "input_form", "quick_input", "ai", "end"].map((type) => (
            <Button key={type} size="sm" variant="outline" onClick={() => addFlowNode(type)}>
              + {type === "input_form" ? "Input Form" : type === "quick_input" ? "Quick Input" : type.charAt(0).toUpperCase() + type.slice(1)}
            </Button>
          ))}
        </div>

        <Separator className="my-4" />

        <label className="mb-1 block text-xs text-slate-500">Description</label>
        <Textarea rows={3} value={flowDescription} onChange={(e) => setFlowDescription(e.target.value)} placeholder="What this flow does" />

        <Separator className="my-4" />

        {selectedNode ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Node</p>
            <Input value={selectedNode.data?.label || ""} onChange={(e) => updateSelectedNodeData({ label: e.target.value })} placeholder="Label" />
            <p className="text-[11px] text-slate-500">Type: {selectedNode.type}</p>

            {(selectedNode.type === "message" ||
              selectedNode.type === "condition" ||
              selectedNode.type === "buttons" ||
              selectedNode.type === "carousel" ||
              selectedNode.type === "select" ||
              selectedNode.type === "input_form" ||
              selectedNode.type === "quick_input") && (
              <Input value={selectedNode.data?.text || ""} onChange={(e) => updateSelectedNodeData({ text: e.target.value })} placeholder="Message text" />
            )}

            {selectedNode.type === "buttons" && (
              <Input
                value={Array.isArray(selectedNode.data?.buttons) ? selectedNode.data.buttons.join(", ") : ""}
                onChange={(e) =>
                  updateSelectedNodeData({
                    buttons: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                  })
                }
                placeholder="Button labels, comma separated"
              />
            )}

            {selectedNode.type === "select" && (
              <div className="space-y-2">
                <Input value={selectedNode.data?.placeholder || ""} onChange={(e) => updateSelectedNodeData({ placeholder: e.target.value })} placeholder="Select placeholder" />
                <Input value={selectedNode.data?.buttonLabel || ""} onChange={(e) => updateSelectedNodeData({ buttonLabel: e.target.value })} placeholder="Submit button label" />
                <Input
                  value={Array.isArray(selectedNode.data?.options) ? selectedNode.data.options.join(", ") : ""}
                  onChange={(e) =>
                    updateSelectedNodeData({
                      options: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                    })
                  }
                  placeholder="Options, comma separated"
                />
              </div>
            )}

            {selectedNode.type === "carousel" && (
              <Textarea
                rows={6}
                value={carouselItemsText}
                onChange={(e) => {
                  const items = e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [title, description, price, imageUrl] = line.split("|").map((part) => part.trim());
                      return {
                        title: title || "Item",
                        description: description || "",
                        price: price || "",
                        imageUrl: imageUrl || "",
                        buttons: [{ label: "View", value: title || "View item" }],
                      };
                    });
                  updateSelectedNodeData({ items });
                }}
                placeholder="One item per line: title | description | price | imageUrl"
              />
            )}

            {selectedNode.type === "input_form" && (
              <div className="space-y-2">
                <Input value={selectedNode.data?.submitLabel || ""} onChange={(e) => updateSelectedNodeData({ submitLabel: e.target.value })} placeholder="Submit label" />
                <Textarea
                  rows={6}
                  value={Array.isArray(selectedNode.data?.fields)
                    ? selectedNode.data.fields
                        .map((field) => [field?.name || "", field?.label || "", field?.placeholder || "", field?.type || "text", String(field?.required ?? true)].join(" | "))
                        .join("\n")
                    : ""}
                  onChange={(e) => {
                    const fields = e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                      .map((line) => {
                        const [name, label, placeholder, type, required] = line.split("|").map((part) => part.trim());
                        return {
                          name: name || "field",
                          label: label || name || "Field",
                          placeholder: placeholder || "",
                          type: type || "text",
                          required: required ? required.toLowerCase() !== "false" : true,
                        };
                      });
                    updateSelectedNodeData({ fields });
                  }}
                  placeholder="One field per line: name | label | placeholder | type | required"
                />
              </div>
            )}

            {selectedNode.type === "quick_input" && (
              <div className="space-y-2">
                <Input value={selectedNode.data?.placeholder || ""} onChange={(e) => updateSelectedNodeData({ placeholder: e.target.value })} placeholder="Input placeholder" />
                <Input value={selectedNode.data?.buttonLabel || ""} onChange={(e) => updateSelectedNodeData({ buttonLabel: e.target.value })} placeholder="Button label" />
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={selectedNode.data?.inputType || "text"}
                  onChange={(e) => updateSelectedNodeData({ inputType: e.target.value })}
                >
                  <option value="text">text</option>
                  <option value="email">email</option>
                  <option value="tel">tel</option>
                </select>
              </div>
            )}

            {selectedNode.type === "trigger" && (
              <div className="space-y-2">
                <label className="block text-[11px] text-slate-500">Run When</label>
                <select
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={selectedNode.data?.on || "widget_open"}
                  onChange={(e) => updateSelectedNodeData({ on: e.target.value })}
                >
                  <option value="widget_open">Widget opens</option>
                  <option value="page_open">Page opens</option>
                  <option value="first_message">First visitor message</option>
                  <option value="any_message">Any visitor message</option>
                </select>
                <Input
                  value={Array.isArray(selectedNode.data?.keywords) ? selectedNode.data.keywords.join(", ") : ""}
                  onChange={(e) =>
                    updateSelectedNodeData({
                      keywords: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                    })
                  }
                  placeholder="keywords, comma separated (for message triggers)"
                />
              </div>
            )}

            {selectedNode.type === "condition" && (
              <Input
                value={selectedNode.data?.contains || ""}
                onChange={(e) => updateSelectedNodeData({ contains: e.target.value })}
                placeholder="Contains text"
              />
            )}

            {selectedNode.type === "ai" && (
              <Textarea rows={4} value={selectedNode.data?.prompt || ""} onChange={(e) => updateSelectedNodeData({ prompt: e.target.value })} placeholder="AI instruction prompt" />
            )}

            {(selectedNode.type === "message" ||
              selectedNode.type === "ai" ||
              selectedNode.type === "buttons" ||
              selectedNode.type === "carousel" ||
              selectedNode.type === "select" ||
              selectedNode.type === "input_form" ||
              selectedNode.type === "quick_input") && (
              <Input
                type="number"
                min={100}
                max={6000}
                value={selectedNode.data?.delayMs ?? 420}
                onChange={(e) => updateSelectedNodeData({ delayMs: Number(e.target.value || 420) })}
                placeholder="Delay ms"
              />
            )}

            <Button size="sm" variant="destructive" onClick={removeSelectedNode}>
              Remove Node
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-400">Select a node to edit its fields.</p>
        )}
      </aside>
    </div>
  );
}

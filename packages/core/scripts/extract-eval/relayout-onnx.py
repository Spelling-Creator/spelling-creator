"""Turn an onnxruntime-genai model builder export into the layout transformers.js loads.

    python relayout-onnx.py <builder output dir> <destination dir> <dtype suffix> [<hf checkpoint dir>]

The onnx-community LFM2 files that transformers.js runs are made with the same
builder (python -m onnxruntime_genai.models.builder). Its raw output differs
from that layout in three small ways, all fixed here:

1. The convolution caches are named past.N.conv / present.N.conv; transformers.js
   feeds past_conv.N and maps present_conv.N back to it.
2. The key/value cache's head dimension is symbolic; transformers.js sizes the
   first empty cache from the declared shape and reads a symbolic dim as 0.
3. The chat template is a separate chat_template.jinja; transformers.js reads
   tokenizer_config.json's chat_template. The graph also goes under
   onnx/model_<dtype>.onnx with its weights in model_<dtype>.onnx_data, beside
   config.json and the tokenizer files.

Run it once per precision into the same destination (q4 from an "-e cpu" build,
q4f16 from an "-e webgpu" build) and the destination is a complete repo.
"""

import json
import os
import re
import shutil
import sys

import onnx

src, dest, dtype = sys.argv[1:4]
checkpoint = sys.argv[4] if len(sys.argv) > 4 else src

model = onnx.load(os.path.join(src, "model.onnx"), load_external_data=True)

renames = {}
for value in list(model.graph.input) + list(model.graph.output):
    m = re.fullmatch(r"(past|present)\.(\d+)\.conv", value.name)
    if m:
        renames[value.name] = f"{m.group(1)}_conv.{m.group(2)}"
for value in list(model.graph.input) + list(model.graph.output):
    if value.name in renames:
        value.name = renames[value.name]
for node in model.graph.node:
    node.input[:] = [renames.get(n, n) for n in node.input]
    node.output[:] = [renames.get(n, n) for n in node.output]

config = json.load(open(os.path.join(checkpoint, "config.json")))
head_dim = config.get("head_dim") or config["hidden_size"] // config["num_attention_heads"]
fixed = 0
for value in list(model.graph.input) + list(model.graph.output):
    if re.fullmatch(r"(past_key_values|present)\.\d+\.(key|value)", value.name):
        dims = value.type.tensor_type.shape.dim
        if len(dims) == 4 and not dims[3].HasField("dim_value"):
            dims[3].dim_value = head_dim
            fixed += 1

onnx_dir = os.path.join(dest, "onnx")
os.makedirs(onnx_dir, exist_ok=True)
out_name = f"model_{dtype}.onnx"
onnx.save_model(
    model,
    os.path.join(onnx_dir, out_name),
    save_as_external_data=True,
    all_tensors_to_one_file=True,
    location=f"{out_name}_data",
    size_threshold=0,
)

# config.json, with the settings transformers.js reads: that this precision's
# weights live in one external file (the browser only fetches the _data file
# when told so), and that the fp16 variants keep their KV cache in float16.
config_path = os.path.join(dest, "config.json")
dest_config = json.load(open(config_path)) if os.path.exists(config_path) else dict(config)
tjs = dest_config.setdefault("transformers.js_config", {})
tjs.setdefault("use_external_data_format", {})[out_name] = 1
if dtype in ("q4f16", "fp16"):
    tjs.setdefault("kv_cache_dtype", {})[dtype] = "float16"
json.dump(dest_config, open(config_path, "w"), indent=2)
for name in ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
    path = os.path.join(src, name) if os.path.exists(os.path.join(src, name)) else os.path.join(checkpoint, name)
    if os.path.exists(path):
        shutil.copy(path, os.path.join(dest, name))
tokenizer_config_path = os.path.join(dest, "tokenizer_config.json")
tokenizer_config = json.load(open(tokenizer_config_path))
if "chat_template" not in tokenizer_config:
    for folder in (src, checkpoint):
        template = os.path.join(folder, "chat_template.jinja")
        if os.path.exists(template):
            tokenizer_config["chat_template"] = open(template).read()
            break
json.dump(tokenizer_config, open(tokenizer_config_path, "w"), indent=1)

print(f"{out_name}: renamed {len(renames)} conv caches, set head dim {head_dim} on {fixed} KV tensors")
print("inputs:", [i.name for i in model.graph.input][:4], "...", len(model.graph.input))
print("wrote", os.path.join(onnx_dir, out_name))

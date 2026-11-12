/* The AI models used for lens blur. Shared by the server (which fetches each file from Hugging Face once and keeps
   it on disk) and the browser (which runs them on its own GPU; photos never leave the computer).
   Revisions are pinned so a cached file can never change under the app. */
export interface ModelFile { repo: string; rev: string; file: string; size: number; name: string; license: string }

export const MODELS = {
  // Depth Anything V2 Small: relative depth for every pixel (Apache-2.0)
  'depth-fp16': { repo: 'onnx-community/depth-anything-v2-small', rev: '4472b7362082ad9968fee890ca0f1e5aca36b93d', file: 'onnx/model_fp16.onnx', size: 49642442, name: 'Depth Anything V2', license: 'Apache-2.0' },
  'depth-q8': { repo: 'onnx-community/depth-anything-v2-small', rev: '4472b7362082ad9968fee890ca0f1e5aca36b93d', file: 'onnx/model_quantized.onnx', size: 27258801, name: 'Depth Anything V2', license: 'Apache-2.0' },
  // BEN2 (Background Erase Network): a fine matte of the main subject, hair included (MIT).
  // BiRefNet was the first choice, but its graph needs more storage buffers per shader than Apple GPUs allow.
  'subject-fp16': { repo: 'onnx-community/BEN2-ONNX', rev: 'c552aa82688edce09f0ac9d2e31ad53d9d629010', file: 'onnx/model_fp16.onnx', size: 219121675, name: 'BEN2', license: 'MIT' },
} satisfies Record<string, ModelFile>

export type ModelId = keyof typeof MODELS
export const modelUrl = (id: ModelId) => '/api/model?id=' + id
export const hfUrl = (m: ModelFile) => `https://huggingface.co/${m.repo}/resolve/${m.rev}/${m.file}`

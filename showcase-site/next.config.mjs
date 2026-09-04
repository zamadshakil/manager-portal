import path from "node:path"
import { fileURLToPath } from "node:url"
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..")
const config = {output:"export",trailingSlash:true,images:{unoptimized:true},turbopack:{root},experimental:{externalDir:true},agentRules:false}
export default config

import { copyFile,mkdir } from "node:fs/promises"
const root=new URL("../",import.meta.url)
const dest=new URL("showcase-site/public/showcase/resources/",root)
await mkdir(dest,{recursive:true})
await copyFile(new URL("public/showcase/resources/worksheet.txt",root),new URL("worksheet.txt",dest))

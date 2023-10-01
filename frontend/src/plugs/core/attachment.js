import { applyQuery } from "../../plug-api/lib/query.js";
import { space } from "../../plug-api/silverbullet-syscall/mod.js";
export async function attachmentQueryProvider({ query }) {
  return applyQuery(query, await space.listAttachments());
}

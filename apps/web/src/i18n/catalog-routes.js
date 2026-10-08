import workspace from "./catalog-routes-workspace";
import reader from "./catalog-routes-reader";
import assessment from "./catalog-routes-assessment";
import evidence from "./catalog-routes-evidence";
import errors from "./catalog-routes-errors";

export default [...workspace, ...reader, ...assessment, ...evidence, ...errors];

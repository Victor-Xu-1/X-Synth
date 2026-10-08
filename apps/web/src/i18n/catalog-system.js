import shell from "./catalog-system-shell";
import environments from "./catalog-system-environments";
import accounts from "./catalog-system-accounts";
import banlist from "./catalog-system-banlist";

export default [...shell, ...environments, ...accounts, ...banlist];

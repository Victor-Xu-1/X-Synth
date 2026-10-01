# Migration Map

| Component | Source Path | Target Path | Migration Mode |
|---|---|---|---|
| ASKCOS full tree | /home/victor_1/ASKCOSv2 | /home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2 | full program tree copy; runtime/heavy assets present locally but git-ignored |
| ASKCOS core | /home/victor_1/ASKCOSv2/askcos2_core | /home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos2_core | full source inside ASKCOS tree |
| ASKCOS Vue UI | /home/victor_1/ASKCOSv2/askcos-vue-nginx/askcos_vue | /home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos-vue-nginx/askcos_vue | full source inside ASKCOS tree |
| AiZynthFinder | /home/victor_1/DeepRetro/aizynthfinder | /home/victor_1/synon-retrosynthesis-platform/engines/aizynthfinder | full local engine/model config copy |
| Existing SMILES2Route experiments | /home/victor_1/projects/smiles2route_agent_agentic_v8 | not migrated into runtime | reference only |

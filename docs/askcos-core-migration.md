# ASKCOS Core Migration

Source: `/home/victor_1/ASKCOSv2/askcos2_core`
Target: `/home/victor_1/synon-retrosynthesis-platform/apps/askcos-v2/askcos2_core`

ASKCOS is migrated as a full top-level project tree so compose build contexts such as `../tree_search/mcts`, `../retro/template_relevance`, and `../askcos-vue-nginx` remain valid.

ASKCOS core remains the primary FastAPI backend and owns:

- task submission
- MCTS
- RetroStar
- ExpandOne
- Mongo-backed result history
- buyables integration
- native ASKCOS wrappers and utils

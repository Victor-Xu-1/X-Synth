#!/bin/sh
set -eu

worker_pids=""

shutdown_workers() {
  for pid in $worker_pids; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait || true
}

trap shutdown_workers INT TERM

start_worker() {
  concurrency="$1"
  queue_name="$2"
  worker_name="$2"

  echo "Starting celery worker ${worker_name} on queue ${queue_name} with concurrency ${concurrency}"
  celery -A askcos2_celery worker \
    -c "$concurrency" \
    -Q "$queue_name" \
    -n "${worker_name}@%h" \
    --pool=gevent &
  worker_pids="$worker_pids $!"
}

start_worker 2 context_recommender_worker
start_worker 2 forward_worker
start_worker 1 general_selectivity_worker
start_worker 1 impurity_predictor_worker
start_worker 1 pathway_ranker_worker
start_worker 2 retro_worker
start_worker 1 site_selectivity_worker
start_worker 2 tree_analysis_worker
start_worker 2 tree_search_expand_one_worker
start_worker 2 tree_search_mcts_worker
start_worker 2 tree_search_retro_star_worker
start_worker 1 tree_search_worker
start_worker 20 generic_worker

while true; do
  for pid in $worker_pids; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "Celery worker process ${pid} exited; stopping remaining workers."
      shutdown_workers
      exit 1
    fi
  done
  sleep 5
done

"""The sole scientific implementation: official BayBE Campaign.recommend."""

import os
from importlib.metadata import version

from .contracts import (
    BAYBE_VERSION,
    NextExperiment,
    OptimizationRequest,
    OptimizationResult,
)
from .prepare import prepare_experiment
from .tables import export_recommendations


def runtime_versions() -> dict[str, str]:
    import platform

    versions = {
        name: version(name)
        for name in (
            "baybe",
            "botorch",
            "gpytorch",
            "torch",
            "numpy",
            "pandas",
            "scipy",
            "pydantic",
        )
    }
    versions["python"] = platform.python_version()
    if versions["baybe"] != BAYBE_VERSION:
        raise RuntimeError("The reviewed BayBE runtime version is required.")
    return versions


def recommend(request: OptimizationRequest) -> OptimizationResult:
    versions = runtime_versions()
    prepared = prepare_experiment(request)
    import pandas as pd
    import torch
    from baybe import Campaign
    from baybe.acquisition import qLogExpectedImprovement
    from baybe.objectives import SingleTargetObjective
    from baybe.parameters import CategoricalParameter, NumericalDiscreteParameter
    from baybe.recommenders import BotorchRecommender
    from baybe.searchspace import SearchSpace
    from baybe.settings import Settings
    from baybe.surrogates import GaussianProcessSurrogate
    from baybe.targets import NumericalTarget

    torch.set_num_threads(int(os.environ["OMP_NUM_THREADS"]))
    torch.set_num_interop_threads(1)
    parameters = [
        NumericalDiscreteParameter(name=factor.name, values=factor.values, tolerance=0)
        if factor.kind == "numerical"
        else CategoricalParameter(
            name=factor.name, values=factor.values, encoding="OHE"
        )
        for factor in request.factors
    ]
    with Settings(random_seed=request.seed):
        campaign = Campaign(
            searchspace=SearchSpace.from_product(parameters),
            objective=SingleTargetObjective(
                NumericalTarget(
                    name=request.target.name,
                    minimize=request.target.direction == "minimize",
                )
            ),
            recommender=BotorchRecommender(
                surrogate_model=GaussianProcessSurrogate(),
                acquisition_function=qLogExpectedImprovement(),
            ),
            allow_recommending_already_measured=False,
            allow_recommending_already_recommended=False,
        )
        campaign.add_measurements(pd.DataFrame(prepared.measurements))
        next_conditions = campaign.recommend(batch_size=request.batch_size)
        # Identity target: posterior remains in the measured response's original units.
        posterior = campaign.posterior(next_conditions)
        means = posterior.mean.detach().cpu().reshape(-1).tolist()
        stds = posterior.variance.detach().cpu().sqrt().reshape(-1).tolist()
    names = [factor.name for factor in request.factors]
    recommendations = [
        NextExperiment(
            conditions={name: row[name] for name in names},
            posterior_mean=mean,
            posterior_std=std,
        )
        for row, mean, std in zip(
            next_conditions.to_dict("records"), means, stds, strict=True
        )
    ]
    warnings = [
        "建议条件尚未实验确认；后验标准差是模型对潜在响应的不确定性，不是实验误差或成功概率。",
        "分类因子使用独热编码；没有结构描述符、机理或文献约束。候选组合的安全性与可操作性需专业核验。",
    ]
    if len(prepared.measurements) < 10:
        warnings.append("当前实测记录少于 10 条，模型预测与不确定性可能不稳定。")
    if request.target.kind == "yield_percent" and any(
        not 0 <= row.posterior_mean <= 100 for row in recommendations
    ):
        warnings.append("部分后验均值超出收率物理范围；未裁剪预测，不能作为实验收率。")
    return OptimizationResult(
        request_sha256=prepared.request_sha256,
        table_sha256=request.table_sha256,
        versions=versions,
        seed=request.seed,
        selected_rows=request.selected_rows,
        measurement_count=len(prepared.measurements),
        unique_measured_conditions=len(prepared.measured_keys),
        candidate_count=prepared.candidate_count,
        remaining_before_batch=prepared.remaining,
        best_observed=prepared.best_observed,
        target=request.target,
        recommendations=recommendations,
        warnings=warnings,
        csv_content=export_recommendations(
            names,
            request.target.name,
            recommendations,
            prepared.request_sha256,
        ),
    )

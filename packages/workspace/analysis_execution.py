"""Framework-independent execution and immutable scientific-record lifecycle."""


def analysis_runner(repository):
    def run(*, owner, kind, inputs, execute):
        identifier = repository.start(owner, kind, inputs)
        try:
            output = execute()
            result = (
                output.model_dump(mode="json")
                if hasattr(output, "model_dump")
                else output
            )
            if not isinstance(result, dict):
                raise TypeError("Invalid scientific analysis output")
            repository.finish(identifier, owner, result=result)
        except Exception:
            repository.finish(
                identifier,
                owner,
                error="该次计算未完成，请在工作区检查输入或模型状态后重试。",
            )
            raise
        return {**result, "record_id": identifier}

    return run

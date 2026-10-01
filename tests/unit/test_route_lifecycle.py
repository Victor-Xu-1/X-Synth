from packages.validation.route_lifecycle import RouteLifecycle


def test_lifecycle_moves_zero_closed_result_to_second_pass():
    lifecycle = RouteLifecycle(min_routes=3)

    assert lifecycle.next_status(closed_route_count=0, pass_number=1) == "second_pass_required"


def test_lifecycle_does_not_mark_unclosed_as_completed_after_second_pass():
    lifecycle = RouteLifecycle(min_routes=3)

    assert lifecycle.next_status(closed_route_count=0, pass_number=2) == "failed_unclosed"


def test_lifecycle_marks_enough_routes_complete():
    lifecycle = RouteLifecycle(min_routes=3)

    assert lifecycle.next_status(closed_route_count=3, pass_number=1) == "completed"

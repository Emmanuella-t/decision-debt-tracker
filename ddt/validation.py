from __future__ import annotations

from datetime import date

TITLE_MAX = 120
CATEGORY_MAX = 40


class DecisionDataError(ValueError):
    """Raised when a decision cannot be stored safely."""


def validate_new_decision(
    *,
    title: str,
    category: str,
    impact: int,
    stress: int,
    created_date: date,
    due_date: date | None,
    today: date,
) -> tuple[str, str]:
    cleaned_title = title.strip()
    cleaned_category = category.strip()

    if not cleaned_title:
        raise DecisionDataError("Decision title cannot be blank.")
    if len(cleaned_title) > TITLE_MAX:
        raise DecisionDataError(f"Decision title must be {TITLE_MAX} characters or fewer.")
    if not cleaned_category:
        raise DecisionDataError("Category cannot be blank.")
    if len(cleaned_category) > CATEGORY_MAX:
        raise DecisionDataError(f"Category must be {CATEGORY_MAX} characters or fewer.")

    _require_rating("impact", impact)
    _require_rating("stress", stress)

    if not isinstance(created_date, date) or isinstance(created_date, bool):
        raise DecisionDataError("Enter a real calendar date for the created date.")
    if created_date > today:
        raise DecisionDataError("The created date cannot be in the future.")
    if due_date is not None and due_date < created_date:
        raise DecisionDataError(
            "The due date cannot be earlier than the date this decision was created."
        )

    return cleaned_title, cleaned_category


def validate_resolution(*, created_date: date, resolved_date: date, today: date) -> None:
    if resolved_date < created_date:
        raise DecisionDataError(
            "The resolution date cannot be earlier than the date this decision was created."
        )
    if resolved_date > today:
        raise DecisionDataError("The resolution date cannot be in the future.")


def _require_rating(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DecisionDataError(f"{name.capitalize()} must be a whole number from 1 to 5.")
    if value < 1 or value > 5:
        raise DecisionDataError(f"{name.capitalize()} must be a whole number from 1 to 5.")

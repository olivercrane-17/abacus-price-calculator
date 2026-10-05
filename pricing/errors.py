class ValidationError(Exception):
    """Raised when a quote request is invalid.

    `errors` is a list of {"field": ..., "message": ...} dicts with plain-English
    messages written for staff.
    """

    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("; ".join(f"{e['field']}: {e['message']}" for e in self.errors))

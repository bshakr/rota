# The same occurrence as the admin sees it in "What we found", plus the model's one-line reason for
# the verdict. A subclass rather than a flag because the split is a privacy boundary, not an option:
# spec section 13 keeps the member payload to title, dates, kind and member ids, and a serializer
# that can be asked for either shape is one argument away from handing out the wrong one.
class CalendarEventPreviewSerializer < CalendarEventSerializer
  def as_json = super.merge(reason: record.reason)
end

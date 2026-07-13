# Structured, machine-readable error bodies for the admin API.
#
# The web app maps a failure to a toast rather than parsing prose, so every error the API returns
# carries a stable `error` code as its first-class field (RFC 7807-ish, not the strict media type).
# Authenticatable's `unauthorized` and TenantScoped's `not_found` already speak this shape — one
# `error` key — and this adds the two the domain endpoints need: a validation failure with the
# offending fields, and a generic problem renderer for the guards a model cannot express (a
# schedule change that needs confirming, an attempt to rewrite a past shift).
module ApiErrorRendering
  extend ActiveSupport::Concern

  included do
    # A write that a model rejected. Raised by `save!`/`update!`/`create!`, so a controller can use
    # the bang methods and trust the invalid case renders one consistent 422 rather than each action
    # remembering to check `.valid?`.
    rescue_from ActiveRecord::RecordInvalid, with: :render_record_invalid

    # A required parameter the client left out. Rails' default is a bare 400 with no body; this gives
    # it the same structured shape as every other error so the web app has one contract to map.
    rescue_from ActionController::ParameterMissing, with: :render_parameter_missing
  end

  private

  # `code` is the machine-readable string the web app switches on; `message` is the human sentence
  # it can fall back to. Anything else (a `warning` payload, `fields`) rides along as extra members.
  def render_problem(code, status, message: nil, **extra)
    body = { error: code }
    body[:message] = message if message
    render json: body.merge(extra), status: status
  end

  # `fields` mirrors ActiveModel's own shape — attribute name to its messages — so a form can put
  # each error back beside the input that caused it, while `message` is the whole thing in one line
  # for a toast.
  def render_record_invalid(exception)
    record = exception.record
    render_problem(
      "validation_failed",
      :unprocessable_content,
      message: record.errors.full_messages.to_sentence,
      fields: record.errors.messages
    )
  end

  def render_parameter_missing(exception)
    render_problem("parameter_missing", :bad_request, message: "#{exception.param} is required.")
  end
end

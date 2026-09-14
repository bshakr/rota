module Internal
  # The one write path into the events table from outside this process.
  #
  # The web app owns four events that Rails cannot see: three the browser sends (landing_view,
  # cta_click, signin_started) and one its /callback route sends after WorkOS hosts the sign-in form.
  # They arrive here server-to-server, from Next, carrying a shared secret.
  #
  # ONLY the anonymous four. A browser can reach the Next handler that forwards here, so if this
  # endpoint accepted `first_text_delivered` then anyone could post the number the entire funnel
  # exists to measure. Group events are written in-process by the controllers that cause them and
  # have no HTTP path at all — that is the boundary, and it is why this list is not simply NAMES.
  #
  # Outside the `api` namespace on purpose: there is no WorkOS token here and no tenant to scope to.
  class AnalyticsEventsController < ApplicationController
    before_action :verify_shared_secret

    def create
      name = params[:name].to_s
      return head :unprocessable_content unless AnalyticsEvent::ANONYMOUS_NAMES.include?(name)

      AnalyticsEvent.record(name, **submitted_properties)
      head :no_content
    end

    private

    # Permitted as named scalars, then sanitised again by the model. Two passes rather than one
    # because this side knows what a request may contain and the model knows what a row may contain,
    # and the day those two disagree should be a dropped property, not a stored surprise.
    def submitted_properties
      raw = params[:properties]
      return {} unless raw.is_a?(ActionController::Parameters)

      raw.permit(*AnalyticsEvent::PROPERTY_KEYS).to_h.symbolize_keys
    end

    # 404, not 403, when no secret is configured: an unconfigured deploy should look like it has no
    # such endpoint rather than like it has one worth guessing at. `secure_compare` rather than `==`
    # because a string comparison that returns early leaks the secret one byte at a time; this is the
    # variable-length form, so a wrong-length guess is not a shortcut either.
    def verify_shared_secret
      expected = Rails.configuration.x.analytics.shared_secret
      return head :not_found if expected.blank?

      provided = request.headers["X-Analytics-Secret"].to_s
      return if ActiveSupport::SecurityUtils.secure_compare(provided, expected)

      head :forbidden
    end
  end
end

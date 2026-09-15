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
  # One thing arrives here that is not an event and never becomes one: the DAILY VISITOR CODE, in
  # `X-Analytics-Visitor`. It is read, answered and dropped inside `counted_properties` below, and
  # what the row keeps is a single boolean saying whether this browser had been here yet today.
  #
  # Outside the `api` namespace on purpose: there is no WorkOS token here and no tenant to scope to.
  class AnalyticsEventsController < ApplicationController
    before_action :verify_shared_secret

    def create
      name = params[:name].to_s
      return head :unprocessable_content unless AnalyticsEvent::ANONYMOUS_NAMES.include?(name)

      AnalyticsEvent.record(name, **submitted_properties, **counted_properties(name))
      head :no_content
    end

    private

    # Permitted as named scalars, then sanitised again by the model. Two passes rather than one
    # because this side knows what a request may contain and the model knows what a row may contain,
    # and the day those two disagree should be a dropped property, not a stored surprise.
    #
    # SENT_PROPERTY_KEYS, not PROPERTY_KEYS. The difference between the two lists is
    # `first_visit_today`, which is decided below from a header rather than taken from a body: a
    # caller who could set it could add a thousand visitors to the traffic page without sending a
    # thousand visits.
    def submitted_properties
      raw = params[:properties]
      return {} unless raw.is_a?(ActionController::Parameters)

      raw.permit(*AnalyticsEvent::SENT_PROPERTY_KEYS).to_h.symbolize_keys
    end

    # Is this browser new today? Merged last, so it wins whatever the body claimed — belt to the
    # braces of leaving it off the permitted list above.
    #
    # The daily visitor code arrives in `X-Analytics-Visitor` (apps/web/src/lib/analytics-server.ts)
    # and goes no further than DailyVisitor: it is not stored on the event, not logged, and not kept
    # in any form the answer could be traced back through. What survives this method is one boolean.
    #
    # Landing views only, and the check is here rather than in the web app alone, because this
    # endpoint has to hold on its own: a `cta_click` carrying a code would put the same identifier
    # on three rows of one visit, which is the join analytics_events exists not to have.
    #
    # NO CODE MEANS NO PROPERTY, never `false`. A visit that carried nothing is not a visit by a
    # browser that had already been here; it is a visit nobody counted, which is what every row
    # before this shipped and every row on a deploy with no shared secret is. The traffic page reads
    # absent and false differently and both readings have to stay available to it.
    def counted_properties(name)
      return {} unless name == AnalyticsEvent::LANDING_VIEW

      digest = request.headers["X-Analytics-Visitor"]
      first = DailyVisitor.claim(digest)
      return {} if first.nil?

      { AnalyticsEvent::FIRST_VISIT_TODAY.to_sym => first }
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

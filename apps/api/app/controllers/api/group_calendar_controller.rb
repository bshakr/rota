module Api
  # The house calendar link (BLO-1667): connect, sync now, preview what was found, disconnect.
  # Singular and scoped to the token's group like GroupController, so a house with no link is a 404
  # on sync, events and disconnect — never a glimpse of anyone else's.
  #
  # The one rule that runs through every action: the pasted URL is a credential (spec section 5). It
  # goes in as a parameter, is stored, and comes back only as `masked_url`. No response, no error
  # body and no log line may carry it, which is why the 422 below is built from CalendarConnect's
  # code and sentence rather than from the exception's inspection.
  class GroupCalendarController < BaseController
    # The stored window is 90 days ahead (CalendarSync::FUTURE_DAYS), so asking for more than that
    # can only ever return the same list with a longer query.
    PREVIEW_DAYS = 30
    PREVIEW_DAYS_MAX = CalendarSync::FUTURE_DAYS

    def update
      connection = CalendarConnect.call(group: current_group, url: params.require(:ical_url))
      render json: { calendar: CalendarConnectionSerializer.one(connection),
                     events_preview: preview(connection, PREVIEW_DAYS) }
    rescue CalendarConnect::Invalid => e
      render json: { error: "invalid", code: e.code, fields: { ical_url: [ e.message ] } },
             status: :unprocessable_content
    end

    # "Sync now" is also "try again": pressing it clears `disabled_at`, so a house that gave up on a
    # link after a run of failures is syncing again from this request on (spec section 6 step 5).
    # CalendarSync records its own failures rather than raising, so a calendar that is still broken
    # comes back as a 200 carrying `last_error` — the card says what happened instead of a toast
    # saying something went wrong.
    def sync
      connection = find_connection
      connection.update!(disabled_at: nil)
      CalendarSync.new(connection).call

      render json: { calendar: CalendarConnectionSerializer.one(connection.reload) }
    end

    def events
      days = params.fetch(:days, PREVIEW_DAYS).to_i.clamp(1, PREVIEW_DAYS_MAX)

      render json: { events: preview(find_connection, days) }
    end

    # Disconnect is a fresh start, not a pause: the connection goes, and `dependent: :delete_all`
    # takes every stored event and away match with it (spec section 4).
    def destroy
      find_connection.destroy!
      head :no_content
    end

    private

    # `current_group` is the group the token named, so this is the whole tenancy boundary: there is
    # no id to send, and another house's connection is indistinguishable from no connection at all.
    def find_connection
      current_group.calendar_connection || raise(ActiveRecord::RecordNotFound)
    end

    def preview(connection, days)
      today = current_group.today
      events = connection.calendar_events
        .overlapping(today, today + days)
        .includes(:calendar_event_members, calendar_connection: :group)
        .order(:starts_on, :starts_at)

      CalendarEventPreviewSerializer.many(events)
    end
  end
end

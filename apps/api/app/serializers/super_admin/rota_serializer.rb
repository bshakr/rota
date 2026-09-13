module SuperAdmin
  # A rota as the operator sees it: enough to answer "is this house actually set up" without the
  # roster itself, which is the house's own business and is already implied by its size.
  #
  # A separate class from the house's RotaSerializer, like everything else in this namespace, so
  # that what the operator can see is decided in one file rather than by an argument.
  class RotaSerializer < ApplicationSerializer
    def as_json
      {
        id: record.id,
        name: record.name,
        active: record.active,
        # Derived from the roster, never stored — a flag and a roster can disagree, a derived
        # method cannot. See Rota#draft?.
        draft: record.draft?,
        roster_size: record.rota_positions.size,
        # The schedule as its parts. There is no "every other Tuesday" helper in this app yet, and
        # inventing one here would put the phrasing in the API instead of beside the rest of the
        # console's copy; the web renders these three.
        starts_on: record.starts_on,
        interval_count: record.interval_count,
        interval_unit: record.interval_unit,
        send_hour: record.send_hour,
        reminder_offsets: record.reminder_offsets
      }
    end
  end
end

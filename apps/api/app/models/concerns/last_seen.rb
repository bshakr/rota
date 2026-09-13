# "When did we last hear from this person", written cheaply enough to sit on a read path.
#
# The steady-state authenticated request deliberately writes nothing — GroupAdmin.provision! goes to
# some trouble to keep it that way, because otherwise one valid token drives unbounded write load
# through plain GETs and these reads could never be served from a read replica. A naive `touch` on
# every request would undo all of it.
#
# So the touch is throttled: written only when it is NULL or already an hour stale. An admin
# refreshing their dashboard all morning costs one UPDATE an hour, and the number the super admin
# dashboards read is never more than an hour behind — which is the resolution "last seen" is
# reported at anyway.
module LastSeen
  extend ActiveSupport::Concern

  # How stale the stored value is allowed to get before a request pays to refresh it. Also the
  # width of the window inside which the read path is guaranteed to write nothing at all.
  TOUCH_AFTER = 1.hour

  # `update_column`, not `update!` or `touch`: no validations (a row we did not read in full must
  # not be re-validated on a read), no callbacks, and no updated_at churn that would make every
  # `users` row look edited by a page view. One UPDATE of one column, or nothing.
  def touch_last_seen(now = Time.current)
    return if last_seen_at.present? && last_seen_at > now - TOUCH_AFTER

    update_column(:last_seen_at, now)
  end
end

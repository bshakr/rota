namespace :users do
  # The one-off that fixes the rows that already exist
  # (https://linear.app/bloombase/issue/BLO-1696).
  #
  # From now on an admin's email and name reach their row on their next sign-in, because the AuthKit
  # callback forwards what WorkOS told the web app (see Api::SignInsController). That fixes nobody
  # who does not sign in again, and it cannot fix a house whose admin has stopped visiting at all —
  # so this walks every user still holding a placeholder address or no name and asks the WorkOS
  # directory outright.
  #
  #   bin/rails users:refresh_from_workos
  #
  # Deliberately takes NO arguments. It is run through `railway ssh --service api -- ...`, where the
  # remote shell re-parses the command line and a bracketed rake argument has to survive two rounds
  # of quoting; an argument-free task cannot be got wrong that way.
  #
  # Idempotent, and safe to run as often as you like: it only ever fills a gap (see
  # User#absorb_workos_identity!), so a second run over the same rows writes nothing. Needs
  # WORKOS_API_KEY; without one it refuses rather than reporting an empty success.
  desc "Fill placeholder emails and blank names from the WorkOS directory. Usage: bin/rails users:refresh_from_workos"
  task refresh_from_workos: :environment do
    unless WorkosDirectory.configured?
      abort "WORKOS_API_KEY is not set, so there is nobody to ask. Set it on this service and re-run."
    end

    scope = User.missing_workos_identity.order(:id)
    total = scope.count
    puts "#{total} user#{'s' unless total == 1} with a placeholder email or no name."

    filled = 0
    unchanged = 0
    unknown = 0
    failed = 0

    # One line per row, and every one of them names the row rather than the person in it. This runs
    # over `railway ssh` against production: whatever it prints is on an operator's screen, in their
    # scrollback and in whatever their terminal logs, and an address printed there is an address
    # copied out of the row it was meant to stay in. The id and the WorkOS id are enough to go and
    # look, for anyone who is allowed to.
    #
    # `find_each` batches by ascending id and never revisits a row, so filling a row mid-walk —
    # which takes it out of the scope — cannot make the walk skip the next one.
    scope.find_each do |user|
      identity = WorkosDirectory.identity(user.workos_user_id)

      if identity.nil?
        unknown += 1
        puts "  user #{user.id} (#{user.workos_user_id}): skipped, WorkOS has no such user."
      elsif user.absorb_workos_identity!(identity)
        filled += 1
        puts "  user #{user.id} (#{user.workos_user_id}): filled."
      else
        unchanged += 1
        puts "  user #{user.id} (#{user.workos_user_id}): skipped, WorkOS had nothing to add."
      end
    rescue WorkosDirectory::Unavailable => e
      # One user WorkOS could not answer for must not cost the operator the other nine. The run
      # reports the failure count at the end, and re-running picks the row up again.
      failed += 1
      warn "  user #{user.id} (#{user.workos_user_id}): skipped, #{e.message}"
    end

    puts "Filled #{filled}, already complete #{unchanged}, unknown to WorkOS #{unknown}, failed #{failed}."
  end
end

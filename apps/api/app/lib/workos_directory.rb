# The WorkOS directory, asked directly — the one place in this app that does.
#
# WorkosAccessToken's rule still holds: nothing on the request path asks WorkOS anything, because a
# network round trip in front of an authenticated request would make this API unavailable whenever
# WorkOS is. This has exactly one caller, and it is not on any path: `users:refresh_from_workos`
# (lib/tasks/users.rake), run by hand, once, to fill the rows that were provisioned before the
# sign-in callback started forwarding an admin's identity
# (https://linear.app/bloombase/issue/BLO-1696).
#
# Everything a request needs still arrives the cheap way — the signed token, plus what the web app
# already holds and posts to /api/sign_ins.
class WorkosDirectory
  # There is no API key, so there is nobody to ask. Raised rather than returning nil, because a
  # backfill that silently found nothing and a backfill that was never configured must not look the
  # same to an operator.
  class NotConfigured < StandardError; end

  # WorkOS answered, and the answer was not one we can use — a 5xx, a rate limit, a connection that
  # never opened. The caller decides whether to stop or to carry on to the next row; this only
  # refuses to guess.
  class Unavailable < StandardError; end

  class << self
    # Whether an API key is set at all. The task checks this before it starts, so a missing key is
    # one refusal up front rather than one per user.
    def configured? = api_key.present?

    # What WorkOS holds for one user, as a WorkosIdentity — or nil when WorkOS has no such user,
    # which is a real outcome: a user deleted in WorkOS keeps its row here for the foreign keys.
    def identity(workos_user_id)
      raise NotConfigured, "WORKOS_API_KEY is not set, so there is nobody to ask." unless configured?

      user = client.user_management.get_user(id: workos_user_id)

      WorkosIdentity.new(email: user.email, first_name: user.first_name, last_name: user.last_name)
    rescue WorkOS::NotFoundError
      nil
    rescue WorkOS::Error => e
      raise Unavailable, "WorkOS could not answer for #{workos_user_id}: #{e.class}: #{e.message}"
    end

    private

    # Built per call rather than memoised: this runs a handful of times in a one-off task, and a
    # long-lived client in a class variable is a thing to reason about for no gain at all.
    def client = WorkOS::Client.new(api_key: api_key, client_id: client_id)

    def api_key = Rails.application.config.x.workos.api_key
    def client_id = Rails.application.config.x.workos.client_id
  end
end

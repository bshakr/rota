class CalendarEventMember < ApplicationRecord
  belongs_to :calendar_event
  belongs_to :member
end

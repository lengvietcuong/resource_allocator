# Task

Implement a simple version of the Resource Allocator. The Resource Allocator is a system that transforms the recommendations from Elyx's HealthSpan AI into daily, weekly, monthly or yearly tasks. It also coordinates with other AI agents or humans or resources to adapt the plan based on their availability.

## System Architecture

The **Resource Allocator** functions as a central automated system interacting with multiple inputs and constraints. An **Action Plan** feeds directly into the central system as its primary input. To accurately adapt and schedule the plan, the central hub connects to and evaluates several constraint nodes:
* **Equipment**
* **Specialists**
* **Client's Schedule**
* **Travel Plans**
* **Allied Health**

The resource allocator takes in an action plan - which is a list of activities, ordered by priority (The priority is based on what is most important to their health). Each action in the list can be one of the following subtypes:
1. Activity Type that needs to be done [eg. Run, Eat supplement, do a test]
2. How often does this activity need to be done [3 times a week]
3. Details about the activity [eg. Maintain HR between 120-140]
4. Who will facilitate the activity (eg. trainer)
5. Where can this activity be done?
6. Whether the activity can be facilitated done remotely (ie. by the training talking through a video call)
7. What prep needs to be done to facilitate this activity (eg. Food needs to be cooked)
8. A list of backup activities that can be used to substitute for this activity
9. Adjustments that need to be done if an activity is skipped.
10. Metrics to be collected from this activity.

An activity can be one of the following (as specified in the Activity Type field):
1. Fitness routine / exercise (including things like eye exercise)
2. Food consumption
3. Medication consumption
4. Therapy (sauna / ice bath)
5. Consultation

The remaining nodes (equipment / specialist etc) should be self-explanatory - they refer to constraints:

* **Travel Plans:** Members may have scheduled travel commitments, which could impact their availability.
* **Equipment:** Certain equipment may not always be accessible. A schedule should be in place to track its availability.
* **Specialists:** The availability of specialists should be clearly outlined to ensure proper coordination.
* **Allied Health:** Includes healthcare professionals who support patient care but are not medical doctors, such as physiotherapists, occupational therapists, dietitians, and speech therapists. Their schedules should also be tracked to ensure seamless patient care and team coordination.

## Your task is to:

1. Generate realistic sample test data in the form of csv / json for at least 100 activities.
2. Generate realistic availability data (in csv / json) for the other nodes for 3 months
3. Write a simple scheduler that will take in both the action plan, and the schedules and output a personalised plan.
4. There is no need to build a nice UI - but do output the personalized plan in some kind of calendar format that is readable.
5. Host the app on the internet. Note that submission won't be reviewed if the app is not hosted.
6. Provide a github link and prompts used for the project if any.

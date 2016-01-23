(function() {
    var model = curvilinear.model;

    window.TodoSummary = BaseController.extend({

        datasources: [{

            items: function() {
                return model.get('items');
            }

        }, {

            completedCount: function(data) {
                var complete = 0;

                if (data.items) {
                    data.items.forEach(function(item) {
                        if (item.complete) {
                            complete++;
                        }
                    });
                }

                return complete;
            }

        }],

        template: '<div>{{items|length}} TODOs ({{completedCount}} completed)</div>'

    });
}());
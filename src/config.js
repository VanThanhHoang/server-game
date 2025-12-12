// facebook-comments.config.js
export const facebookCommentsConfig = {
    apiVersion: 'v19.0',
    liveVideoId: '1160226539653463',
    accessToken: 'EAABsbCS1iHgBQOX4vsqGVuZAao20iViWrfPhAVlPN7utREllkH2R6y8ZAO3MyMOZAAABtwi26OqA4wtzZBSoxnyb5d5SXQpMpQlvuWZBMyq0nnX3ADQxtmCugi2nerbDZC2tLB7qbb4CrKkD9TI4FzBZCxoryKgvgLbSs8QvSY2ZBjSPLHewmJijQwe5Dh7YVAZDZD',
    limit: 20,
    filter: 'toplevel',
    liveFilter: 'filter_low_quality',
    order: 'reverse_chronological',
    summaryFields: ['total_count', 'can_comment'],
    fields: 'id,message,from{id,name,picture},created_time',
};

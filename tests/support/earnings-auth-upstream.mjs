// Native security tests must never contact a real identity service.
export default {async fetch(){throw Error('Unexpected outbound network request');}};

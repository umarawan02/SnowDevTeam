/**
 * LaptopRequestUtil — helper API for the "Laptop request" catalog item.
 * Resolves the requester's manager so the workflow can route approval.
 */
var LaptopRequestUtil = Class.create();
LaptopRequestUtil.prototype = {
  initialize: function () {},

  /**
   * @param {string} userSysId - sys_user the request is "requested for"
   * @returns {string} manager sys_id, or empty string when none is set
   */
  getManager: function (userSysId) {
    if (!userSysId) {
      return "";
    }
    var user = new GlideRecord("sys_user");
    user.addQuery("sys_id", userSysId);
    user.setLimit(1);
    user.query();
    if (user.next()) {
      return user.getValue("manager") || "";
    }
    gs.warn("[LaptopRequestUtil] no sys_user found for " + userSysId);
    return "";
  },

  type: "LaptopRequestUtil",
};

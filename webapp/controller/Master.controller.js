/*global history */
sap.ui.define([
	"sap/espm/controller/BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/GroupHeaderListItem",
	"sap/ui/Device",
	"sap/espm/model/formatter",
	"sap/m/MessageBox"
], function(BaseController, JSONModel, Filter, FilterOperator, GroupHeaderListItem, Device, formatter, MessageBox) {
	"use strict";

	return BaseController.extend("sap.espm.controller.Master", {

		formatter: formatter,

		/* =========================================================== */
		/* lifecycle methods                                           */
		/* =========================================================== */

		/**
		 * Called when the master list controller is instantiated. It sets up the event handling for the master/detail communication and other lifecycle tasks.
		 * @public
		 */
		onInit: function() {
			// Control state model
			var oList = this.byId("list"),
				oViewModel = this._createViewModel(),
				// Put down master list's original value for busy indicator delay,
				// so it can be restored later on. Busy handling on the master list is
				// taken care of by the master list itself.
				iOriginalBusyDelay = oList.getBusyIndicatorDelay();
			this._oListSelector = this.getOwnerComponent().oListSelector;

			this._oList = oList;
			// keeps the filter and search state
			this._oListFilterState = {
				aFilter: [],
				aSearch: []
			};

			this.setModel(oViewModel, "masterView");
			// Make sure, busy indication is showing immediately so there is no
			// break after the busy indication for loading the view's meta data is
			// ended (see promise 'oWhenMetadataIsLoaded' in AppController)
			oList.attachEventOnce("updateFinished", function() {
				// Restore original busy indicator delay for the list
				oViewModel.setProperty("/delay", iOriginalBusyDelay);
			});

			this.getView().addEventDelegate({
				onBeforeFirstShow: function() {
					this._oListSelector.setBoundMasterList(oList);
				}.bind(this)
			});

			this.getRouter().getRoute("master").attachPatternMatched(this._onMasterMatched, this);
			this.getRouter().attachBypassed(this.onBypassed, this);
			this._oODataModel = this.getOwnerComponent().getModel();
			
			var oButton2 = new sap.m.Button("Save", {
                    text: "Save",
                    press: this.onSetC2GSavePress.bind(this)
        	});
            var oButton3 = new sap.m.Button("Cancel", {
                    text: "Cancel",
                    press: this.onSetC2GCancelPress.bind(this)
            });
			var oDialog = new sap.m.Dialog("Dialog1",{
                    title:"Dialog",
                    modal: true,
                    contentWidth:"1em",
                    buttons: [oButton2, oButton3],
                    content:[
						new sap.m.Label({text:"Template ID"}),
						new sap.m.Input({
							maxLength: 36,
							id: "TemplateID"
                        })
                    ]
            });
		},

		/* =========================================================== */
		/* event handlers                                              */
		/* =========================================================== */

		/**
		 * After list data is available, this handler method updates the
		 * master list counter and hides the pull to refresh control, if
		 * necessary.
		 * @param {sap.ui.base.Event} oEvent the update finished event
		 * @public
		 */
		onUpdateFinished: function(oEvent) {
			// update the master list object counter after new data is loaded
			this._updateListItemCount(oEvent.getParameter("total"));
			// hide pull to refresh if necessary
			this.byId("pullToRefresh").hide();
			this._findItem();
			this.getModel("appView").setProperty("/addEnabled", true);
		},

		/**
		 * Event handler for the master search field. Applies current
		 * filter value and triggers a new search. If the search field's
		 * 'refresh' button has been pressed, no new search is triggered
		 * and the list binding is refresh instead.
		 * @param {sap.ui.base.Event} oEvent the search event
		 * @public
		 */
		onSearch: function(oEvent) {
			if (oEvent.getParameters().refreshButtonPressed) {
				// Search field's 'refresh' button has been pressed.
				// This is visible if you select any master list item.
				// In this case no new search is triggered, we only
				// refresh the list binding.
				this.onRefresh();
				return;
			}

			var sQuery = oEvent.getParameter("query");

			if (sQuery) {
				this._oListFilterState.aSearch = [new Filter("SupplierName", FilterOperator.Contains, sQuery)];
			} else {
				this._oListFilterState.aSearch = [];
			}
			this._applyFilterSearch();

		},

		/**
		 * Event handler for refresh event. Keeps filter, sort
		 * and group settings and refreshes the list binding.
		 * @public
		 */
		onRefresh: function() {
			this._oList.getBinding("items").refresh();
		},

		/**
		 * Event handler for the sorter selection.
		 * @param {sap.ui.base.Event} oEvent the select event
		 * @public
		 */
		onSort: function(oEvent) {
			var sKey = oEvent.getSource().getSelectedItem().getKey(),
				aSorters = this._oGroupSortState.sort(sKey);

			this._applyGroupSort(aSorters);
		},

		/**
		 * Event handler for the list selection event
		 * @param {sap.ui.base.Event} oEvent the list selectionChange event
		 * @public
		 */
		onSelectionChange: function(oEvent) {
			var that = this;
			var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
			var fnLeave = function() {
				that._oODataModel.resetChanges();
				that._showDetail(oItem);
			};
			if (this._oODataModel.hasPendingChanges()) {
				this._leaveEditPage(fnLeave);
			} else {
				this._showDetail(oItem);
			}
			that.getModel("appView").setProperty("/addEnabled", true);
		},

		/**
		 * Event handler for the bypassed event, which is fired when no routing pattern matched.
		 * If there was an object selected in the master list, that selection is removed.
		 * @public
		 */
		onBypassed: function() {
			this._oList.removeSelections(true);
		},

		/**
		 * Used to create GroupHeaders with non-capitalized caption.
		 * These headers are inserted into the master list to
		 * group the master list's items.
		 * @param {Object} oGroup group whose text is to be displayed
		 * @public
		 * @returns {sap.m.GroupHeaderListItem} group header with non-capitalized caption.
		 */
		createGroupHeader: function(oGroup) {
			return new GroupHeaderListItem({
				title: oGroup.text,
				upperCase: false
			});
		},

		/**
		 * Navigates back in the browser history, if the entry was created by this app.
		 * If not, it navigates to the Fiori Launchpad home page
		 * @override
		 * @public
		 */
		onNavBack: function() {
			var oHistory = sap.ui.core.routing.History.getInstance(),
				sPreviousHash = oHistory.getPreviousHash(),
				oCrossAppNavigator = sap.ushell.Container.getService("CrossApplicationNavigation");

			if (sPreviousHash !== undefined) {
				// The history contains a previous entry
				history.go(-1);
			} else {
				// Navigate back to FLP home
				oCrossAppNavigator.toExternal({
					target: {
						shellHash: "#Shell-home"
					}
				});
			}
		},
		
		/**
		 * Event handler  (attached declaratively) called when the add button in the master view is pressed. it opens the create view.
		 * @public
		 */
		onAdd: function() {
			this.getModel("appView").setProperty("/addEnabled", false);
			this.getRouter().getTargets().display("create");

		},

		onSetC2GSavePress: function () {
			sap.ui.getCore().byId("Dialog1").close();

			var oGlobalModel = sap.ui.getCore().getModel("global");
			var sTemplateId = sap.ui.getCore().byId("TemplateID").getValue();
			oGlobalModel.setProperty("/templateID", sTemplateId);

			this._syncWithC2G(sTemplateId);
		},

		onSetC2GCancelPress: function () {
			sap.ui.getCore().byId("Dialog1").close();
		},

		onSync: function () {
			var that = this;

			var oGlobalModel = sap.ui.getCore().getModel("global");
			var sUsername = oGlobalModel.getProperty("/username");
			var oViewModel = this.getModel("masterView");
			oViewModel.setProperty("/busy", true);

			var oPromise = new Promise(function (fnResolve, fnReject) {
				var url = "/mobileservices/origin/hcpms/CARDS/v1/register/templated";
				var bodyJson = {
					"method": "LIST",
					"templateName": "ESPM",
					"username": sUsername
				};

				jQuery.ajax({
					url : url,
					async : true,
					type: "POST",
					data: JSON.stringify(bodyJson),
					headers: {
						'accept': 'application/json',
						'content-type': 'application/json'
					},
					dataType: "json",
					success : function(oData, sTextStatus, oXhr) {
						if (oXhr.status === 200) {
							console.log("Query Cards:\n"+JSON.stringify(oData)+"\n========");
							fnResolve(oData);
						} else {
							console.log("Query Cards failed: " + oXhr.status);
							fnReject(new Error("Unexpected status return from card query: " + oXhr.status));
						}
					},
					error : function(oXhr, sTextStatus, oError) {
						console.log("Query Cards failed: " + oError + " ("+oXhr.responseText + "/" + sTextStatus + ")");
						fnReject(new Error(oXhr.responseText ? oXhr.responseText : "Error querying card list from Mobile Services"));
					}
				});
			});
			
			oPromise
				.then(function (oData) {
					return that._mergeDataWithC2G(oData);
				})
				.then(function () {
					sap.m.MessageToast.show("Successful sync with Mobile Cards");
				})
				.catch(function (error) {
					sap.m.MessageToast.show("Unable to sync with Mobile Cards: status " + error);
				})
				.then(function () {
					oViewModel.setProperty("/busy", false);
				});
		},
		
		_mergeDataWithC2G: function(oData) {
			function fnMergeCard(aCards, i, sUsername, fnResolve, fnReject) {
				var bodyJson;
				var url = "/mobileservices/origin/hcpms/CARDS/v1/register/templated";
				var oCard = aCards[i];
				var sCardIdentifier = JSON.stringify(oCard.parameters);
				// add or delete?
						if (oCard.Status === "Delete") {
							// delete from C2G
							bodyJson = {
								"method": "DELETE",
								"templateName": "ESPM",
								"parameters": oCard.parameters,
								"username": sUsername
							};

							jQuery.ajax({
								url : url,
								async : true,
								type: "POST",
								data:  JSON.stringify(bodyJson),
								headers: {
									'accept': 'application/json',
									'content-type': 'application/json'
								},
								success : function(data, textStatus, xhr) {
									console.log("Successfully DELETEd card " + sCardIdentifier);
									fnResolve();
								},
								error : function(xhr, textStatus, error) {
									console.log("Failed to DELETE card " + sCardIdentifier);
									fnReject(error);
								}
							});
						} if (oCard.Status === "New") {
							// add to C2G
							bodyJson = {
								"link": window.location.protocol + "//" + window.location.host + window.location.pathname + window.location.search + "#/Suppliers/" + oCard.SupplierId,
								"method": "REGISTER",
								"templateName": "ESPM",
								"parameters": oCard.parameters,
								"username": sUsername
							};

							jQuery.ajax({
								url : url,
								async : true,
								type: "POST",
								data:  JSON.stringify(bodyJson),
								headers: {
									'content-type': 'application/json'
								},
								success : function(data, textStatus, xhr) {
									console.log("Successfully REGISTERed card " + sCardIdentifier);
									fnResolve();
								},
								error : function(xhr, textStatus, error) {
									console.log("Failed to REGISTER card " + sCardIdentifier);
									fnReject(error);
								}
							});
						} else {
							// already there ...
							console.log("Skip card " + sCardIdentifier);
							fnResolve();
						}
			}
					
			var oGlobalModel = sap.ui.getCore().getModel("global");
			var sUsername = oGlobalModel.getProperty("/username");
			
			var aCards = this.getOwnerComponent().oListSelector.buildCardsList(oData);

			var delay = 0;
			var aPromises = [];
			for (var i = 0; i < aCards.length; i++) {
				aPromises.push(new Promise(function(fnResolve, fnReject) {
					setTimeout(fnMergeCard.bind(this, aCards, i, sUsername, fnResolve, fnReject), (delay += 750));
				}));
			}
			return Promise.all(aPromises);
		},

					
		onDeleteAllCards: function () {
			var oGlobalModel = sap.ui.getCore().getModel("global");
			var sUsername = oGlobalModel.getProperty("/username");
			var oViewModel = this.getModel("masterView");
			oViewModel.setProperty("/busy", true);

			var url = "/mobileservices/origin/hcpms/CARDS/v1/register/templated";
			var bodyJson = {
				"method": "DELETEALL",
				"templateName": "ESPM",
				"username": sUsername
			};

			jQuery.ajax({
				url : url,
				async : true,
				type: "POST",
				data: JSON.stringify(bodyJson),
				headers: {
					'accept': 'application/json',
					'content-type': 'application/json'
				},
				dataType: "json",
				success : function(oData, sTextStatus, oXhr) {
					if (oXhr.status === 204) {
						console.log("Delete all Cards succeeded");
						sap.m.MessageToast.show("Successful Delete of all Mobile Cards");
					} else {
						console.log("Delete all Cards failed: " + oXhr.status);
						sap.m.MessageToast.show("Delete All cards failed with status: " + oXhr.status);
					}
					oViewModel.setProperty("/busy", false);
				},
				error : function(oXhr, sTextStatus, oError) {
					console.log("Delete all Cards failed: " + oError + " ("+oXhr.responseText + "/" + sTextStatus + ")");
					sap.m.MessageToast.show("Delete All cards failed: " + sTextStatus);
					oViewModel.setProperty("/busy", false);
				}
			});
		},

		/**
		 * Creates the model for the view
		 * @private
		 */
		_createViewModel: function() {
			return new JSONModel({
				isFilterBarVisible: false,
				filterBarLabel: "",
				delay: 0,
				title: this.getResourceBundle().getText("masterTitleCount", [0]),
				noDataText: this.getResourceBundle().getText("masterListNoDataText"),
				sortBy: "SupplierName",
				groupBy: "None",
				busy: false
			});
		},

		/**
		 * Ask for user confirmation to leave the edit page and discard all changes
		 * @param {object} fnLeave - handles discard changes
		 * @param {object} fnLeaveCancelled - handles cancel
		 * @private
		 */
		_leaveEditPage: function(fnLeave, fnLeaveCancelled) {
			var sQuestion = this.getResourceBundle().getText("warningConfirm");
			var sTitle = this.getResourceBundle().getText("warning");

			MessageBox.show(sQuestion, {
				icon: MessageBox.Icon.WARNING,
				title: sTitle,
				actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
				onClose: function(oAction) {
					if (oAction === MessageBox.Action.OK) {
						fnLeave();
					} else if (fnLeaveCancelled) {
						fnLeaveCancelled();
					}
				}
			});
		},

		/**
		 * If the master route was hit (empty hash) we have to set
		 * the hash to to the first item in the list as soon as the
		 * listLoading is done and the first item in the list is known
		 * @private
		 */
		_onMasterMatched: function() {
			this._oListSelector.oWhenListLoadingIsDone.then(
				function(mParams) {
					if (mParams.list.getMode() === "None") {
						return;
					}
					this.getModel("appView").setProperty("/addEnabled", true);
					if (!mParams.list.getSelectedItem()) {
						this.getRouter().navTo("object", {
							SupplierId: encodeURIComponent(mParams.firstListitem.getBindingContext().getProperty("SupplierId"))
						}, true);
					}
				}.bind(this),
				function(mParams) {
					if (mParams.error) {
						return;
					}
					this.getRouter().getTargets().display("detailNoObjectsAvailable");
				}.bind(this)
			);
		},

		/**
		 * Shows the selected item on the detail page
		 * On phones a additional history entry is created
		 * @param {sap.m.ObjectListItem} oItem selected Item
		 * @private
		 */
		_showDetail: function(oItem) {
			var bReplace = !Device.system.phone;
			this.getRouter().navTo("object", {
				SupplierId: encodeURIComponent(oItem.getBindingContext().getProperty("SupplierId"))
			}, bReplace);
		},

		/**
		 * Sets the item count on the master list header
		 * @param {integer} iTotalItems the total number of items in the list
		 * @private
		 */
		_updateListItemCount: function(iTotalItems) {
			var sTitle;
			// only update the counter if the length is final
			if (this._oList.getBinding("items").isLengthFinal()) {
				sTitle = this.getResourceBundle().getText("masterTitleCount", [iTotalItems]);
				this.getModel("masterView").setProperty("/title", sTitle);
			}
		},

		/**
		 * Internal helper method to apply both filter and search state together on the list binding
		 * @private
		 */
		_applyFilterSearch: function() {
			var aFilters = this._oListFilterState.aSearch.concat(this._oListFilterState.aFilter),
				oViewModel = this.getModel("masterView");
			this._oList.getBinding("items").filter(aFilters, "Application");
			// changes the noDataText of the list in case there are no filter results
			if (aFilters.length !== 0) {
				oViewModel.setProperty("/noDataText", this.getResourceBundle().getText("masterListNoDataWithFilterOrSearchText"));
			} else if (this._oListFilterState.aSearch.length > 0) {
				// only reset the no data text to default when no new search was triggered
				oViewModel.setProperty("/noDataText", this.getResourceBundle().getText("masterListNoDataText"));
			}
		},

		/**
		 * Internal helper method to apply both group and sort state together on the list binding
		 * @private
		 */
		_applyGroupSort: function(aSorters) {
			this._oList.getBinding("items").sort(aSorters);
		},

		/**
		 * Internal helper method that sets the filter bar visibility property and the label's caption to be shown
		 * @param {string} sFilterBarText the selected filter value
		 * @private
		 */
		_updateFilterBar: function(sFilterBarText) {
			var oViewModel = this.getModel("masterView");
			oViewModel.setProperty("/isFilterBarVisible", (this._oListFilterState.aFilter.length > 0));
			oViewModel.setProperty("/filterBarLabel", this.getResourceBundle().getText("masterFilterBarText", [sFilterBarText]));
		},

		/**
		 * Internal helper method that adds "/" to the item's path 
		 * @private
		 */
		_fnGetPathWithSlash: function(sPath) {
			return (sPath.indexOf("/") === 0 ? "" : "/") + sPath;
		},

		/**
		 * It navigates to the saved itemToSelect item. After delete it navigate to the next item. 
		 * After add it navigates to the new added item if it is displayed in the tree. If not it navigates to the first item.
		 * @private
		 */
		_findItem: function() {
			var itemToSelect = this.getModel("appView").getProperty("/itemToSelect");
			if (itemToSelect) {
				var sPath = this._fnGetPathWithSlash(itemToSelect);
				var oItem = this._oListSelector.findListItem(sPath);
				if (!oItem) { //item is not viewable in the tree. not in the current tree page.
					oItem = this._oListSelector.findFirstItem();
					if (oItem) {
						sPath = oItem.getBindingContext().getPath();
					} else {
						this.getRouter().getTargets().display("detailNoObjectsAvailable");
						return;
					}
				}
				this._oListSelector.selectAListItem(sPath);
				this._showDetail(oItem);
			}
		}

	});
});
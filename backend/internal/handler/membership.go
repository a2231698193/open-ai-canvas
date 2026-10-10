package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"yingce/backend/internal/service"
)

// RegisterMembershipRoutes 注册会员路由：用户端信息与管理端配置。
func RegisterMembershipRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/membership/plans", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.UserMembershipPlans(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/membership/plans", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		plans, err := svc.AdminMembershipPlans(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plans": plans})
	})
	r.POST("/admin/membership/plans", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminMembershipPlanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		plan, err := svc.AdminSaveMembershipPlan(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plan": plan})
	})
	r.POST("/admin/users/:id/membership/grant", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			PlanID string `json:"planId"`
			Months int    `json:"months"`
			Note   string `json:"note"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		membership, err := svc.AdminGrantMembership(user, c.Param("id"), req.PlanID, req.Months, req.Note)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"membership": membership})
	})
	r.POST("/admin/users/:id/membership/upgrade", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			PlanID string `json:"planId"`
			Note   string `json:"note"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		membership, err := svc.AdminUpgradeMembership(user, c.Param("id"), req.PlanID, req.Note)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"membership": membership})
	})
	r.POST("/admin/users/:id/membership/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Note string `json:"note"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.AdminCancelMembership(user, c.Param("id"), req.Note); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
